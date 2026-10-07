// A Node test reporter for GitHub Actions. Used by `npm run test:ci`.
// It writes a results table to the run's summary page and turns each failure into an error annotation
// (shown on the run and the commit). The normal readable log still comes from the built-in "spec" reporter.
import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';

const rel = (file) => (file ? relative(process.cwd(), file).replace(/\\/g, '/') : '');
const oneLine = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const errorText = (err) => {
  const e = err && err.cause ? err.cause : err;
  return String((e && e.message) || e || 'failed').trim();
};

export default async function* githubReporter(source) {
  const files = new Map();        // file -> { pass, fail, skip, ms }
  const failures = [];
  const slowest = [];

  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    if (d.details && d.details.type === 'suite') continue;
    const file = rel(d.file) || '(unknown file)';
    const row = files.get(file) || { pass: 0, fail: 0, skip: 0, ms: 0 };
    const ms = (d.details && d.details.duration_ms) || 0;
    row.ms += ms;
    if (event.type === 'test:fail') {
      row.fail++;
      const message = errorText(d.details && d.details.error);
      failures.push({ file, name: d.name, message });
      yield `::error file=${file},line=${d.line || 1},col=${d.column || 1},title=${oneLine(d.name)}::${oneLine(message)}\n`;
    } else if (d.skip || d.todo) row.skip++;
    else row.pass++;
    slowest.push({ name: d.name, ms });
    files.set(file, row);
  }

  const total = [...files.values()].reduce((t, r) => ({ pass: t.pass + r.pass, fail: t.fail + r.fail, skip: t.skip + r.skip }), { pass: 0, fail: 0, skip: 0 });
  const lines = [
    `## ${total.fail ? '❌' : '✅'} Tests: ${total.pass} passed, ${total.fail} failed${total.skip ? `, ${total.skip} skipped` : ''}`,
    '',
    '| File | Passed | Failed | Time |',
    '| --- | ---: | ---: | ---: |',
    ...[...files].sort().map(([f, r]) => `| \`${f}\` | ${r.pass} | ${r.fail ? `**${r.fail}**` : 0} | ${Math.round(r.ms)} ms |`),
  ];
  if (failures.length) {
    lines.push('', '### Failures');
    for (const f of failures) lines.push('', `**${f.name}** (\`${f.file}\`)`, '', '```', f.message, '```');
  }
  const top = slowest.sort((a, b) => b.ms - a.ms).slice(0, 3);
  if (top.length) lines.push('', `Slowest: ${top.map((t) => `${t.name} (${Math.round(t.ms)} ms)`).join(', ')}`);

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
