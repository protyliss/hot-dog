const PUMP       = require('pump');
const GULP       = require('gulp');
const DEBUG      = require('gulp-debug');
const TYPESCRIPT = require('gulp-typescript');

const {task: TASK, watch: WATCH, dest, series: SERIES, parallel: PARALLEL, lastRun: LAST_RUN} = GULP;

const TARGET = (_ => {
	return targets => (Array.isArray(targets) ? targets : [targets]).map(targetMapFunction);

	function targetMapFunction(target) {
		return target.startsWith('!') ?
			'!./src' + target.slice(1) :
			'./src' + target
	}
})();

const SRC = (_ => {
	return (targets, options) => {
		const fixedTargets = TARGET(targets);
		console.info(fixedTargets);
		return GULP.src(
			fixedTargets,
			options
		);
	}

})()

const DEST = (target = '') => {
	return GULP.dest('./dist' + target);
}

const project = TYPESCRIPT.createProject('tsconfig.json');


TASK('ts-compile', _ => {
	return PUMP(
		SRC('/**/*.ts', {since: LAST_RUN('ts-compile')}),
		DEBUG(),
		project(),
		DEST()
	);
});

WATCH(TARGET('/**/*.ts'), SERIES('ts-compile'));

TASK('assets-copy', _ => {
	return PUMP(
		SRC(['/**/*', '!/**/*.ts'], {since: LAST_RUN('assets-copy')}),
		DEBUG(),
		DEST()
	)
})

TASK('package', PARALLEL('ts-compile', 'assets-copy'))

WATCH(TARGET('/**/*', '!/**/*.ts'), SERIES('assets-copy'));

TASK('default', SERIES('package'));