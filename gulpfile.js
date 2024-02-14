import { readFileSync, rmSync } from 'node:fs';

import gulp from 'gulp';
import plumber from 'gulp-plumber';
import { nunjucksCompile } from 'gulp-nunjucks';
import htmlmin from 'gulp-htmlmin';
import * as dartSass from 'sass';
import gulpSass from 'gulp-sass';
import postcss from 'gulp-postcss';
import postUrl from 'postcss-url';
import autoprefixer from 'autoprefixer';
import csso from 'postcss-csso';
// import rename from 'gulp-rename';
import { createGulpEsbuild } from 'gulp-esbuild';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import sharp from 'gulp-sharp-responsive';
import svgo from 'gulp-svgmin';
import { stacksvg } from 'gulp-stacksvg';
import server from 'browser-sync';
import bemlinter from 'gulp-html-bemlinter';

const { src, dest, watch, series, parallel } = gulp;
const sass = gulpSass(dartSass);
const PATH_TO_SOURCE = './source/';
const PATH_TO_DIST = './build/';
const PATH_TO_RAW = './raw/';
const PATHS_TO_STATIC = [
  `${PATH_TO_SOURCE}fonts/**/*.{woff2,woff}`,
  `${PATH_TO_SOURCE}*.ico`,
  `${PATH_TO_SOURCE}*.webmanifest`,
  `${PATH_TO_SOURCE}favicons/**/*.{png,svg}`,
  `${PATH_TO_SOURCE}vendor/**/*`,
  `${PATH_TO_SOURCE}img/**/*`,
  `!${PATH_TO_SOURCE}img/sprite/**/*`,
  `!${PATH_TO_SOURCE}**/README.md`,
];
let isDevelopment = true;

export function processMarkup() {
  return src(`${PATH_TO_SOURCE}**/*.html`)
    .pipe(nunjucksCompile())
    .pipe(htmlmin({ collapseWhitespace: !isDevelopment }))
    .pipe(dest(PATH_TO_DIST))
    .pipe(server.stream());
}

export function lintBem() {
  return src(`${PATH_TO_SOURCE}*.html`)
    .pipe(bemlinter());
}

export function processStyles() {
  return src(`${PATH_TO_SOURCE}scss/*.scss`, { sourcemaps: isDevelopment })
    .pipe(plumber())
    .pipe(sass().on('error', sass.logError))
    .pipe(postcss([
      postUrl({ assetsPath: '../' }),
      autoprefixer(),
      csso()
    ]))
    // .pipe(rename('style.min.css'))
    .pipe(dest(`${PATH_TO_DIST}css`, { sourcemaps: isDevelopment }))
    .pipe(server.stream());
}

export function processScripts() {
  const gulpEsbuild = createGulpEsbuild({ incremental: isDevelopment });

  return src(`${PATH_TO_SOURCE}js/*.js`)
    .pipe(gulpEsbuild({
      bundle: true,
      format: 'esm',
      // splitting: true,
      platform: 'browser',
      minify: !isDevelopment,
      sourcemap: isDevelopment,
      target: browserslistToEsbuild(),
    }))
    .pipe(dest(`${PATH_TO_DIST}js`))
    .pipe(server.stream());
}

export function optimizeRaster() {
  const RAW_DENSITY = 2;
  const TARGET_FORMATS = [undefined, 'webp']; // undefined — initial format: jpg or png

  function createOptionsFormat() {
    const formats = [];

    for (const format of TARGET_FORMATS) {
      for (let density = RAW_DENSITY; density > 0; density--) {
        formats.push(
          {
            format,
            rename: { suffix: `@${density}x` },
            width: ({ width }) => Math.ceil(width * density / RAW_DENSITY),
            jpegOptions: { progressive: true },
          },
        );
      }
    }

    return { formats };
  }

  return src(`${PATH_TO_RAW}img/**/*.{png,jpg,jpeg}`)
    .pipe(sharp(createOptionsFormat()))
    .pipe(dest(`${PATH_TO_SOURCE}img`));
}

export function optimizeVector() {
  return src([`${PATH_TO_RAW}**/*.svg`])
    .pipe(svgo())
    .pipe(dest(PATH_TO_SOURCE));
}

export function createStack() {
  return src(`${PATH_TO_SOURCE}img/sprite/**/*.svg`)
    .pipe(stacksvg({ output: 'sprite' }))
    .pipe(dest(`${PATH_TO_DIST}img`));
}

export function copyStatic() {
  return src(PATHS_TO_STATIC, { base: PATH_TO_SOURCE })
    .pipe(dest(PATH_TO_DIST));
}

export function startServer() {
  server.init({
    server: {
      baseDir: PATH_TO_DIST
    },
    cors: true,
    notify: false,
    ui: false,
  }, (err, bs) => {
    bs.addMiddleware('*', (req, res) => {
      res.write(readFileSync(`${PATH_TO_DIST}404.html`));
      res.end();
    });
  });

  watch(`${PATH_TO_SOURCE}**/*.html`, series(processMarkup));
  watch(`${PATH_TO_SOURCE}scss/**/*.scss`, series(processStyles));
  watch(`${PATH_TO_SOURCE}js/**/*.js`, series(processScripts));
  watch(`${PATH_TO_SOURCE}img/sprite/**/*.svg`, series(createStack, reloadServer));
  // watch(`${PATH_TO_SOURCE}img/svg/**/*.svg`, series(optimizeVector, reloadServer));
  watch(PATHS_TO_STATIC, series(copyStatic, reloadServer));
}

function reloadServer(done) {
  server.reload();
  done();
}

export function removeBuild(done) {
  rmSync(PATH_TO_DIST, {
    force: true,
    recursive: true,
  });
  done();
}

export function buildProd(done) {
  isDevelopment = false;
  series(
    removeBuild,
    parallel(
      processMarkup,
      processStyles,
      processScripts,
      createStack,
      copyStatic,
    ),
  )(done);
}

export function runDev(done) {
  series(
    removeBuild,
    parallel(
      processMarkup,
      processStyles,
      processScripts,
      createStack,
      copyStatic
    ),
    startServer,
  )(done);
}
