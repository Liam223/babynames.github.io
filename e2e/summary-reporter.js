// A Playwright reporter for GitHub Actions: writes a results table to the run's summary page, so the numbers
// show on the Summary tab without opening the job. (Failures are also annotated by Playwright's built-in "github" reporter.)
import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';

const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');

export default class SummaryReporter {
  files = new Map();      // file -> { pass, fail, flaky, skip, ms }
  failures = [];

  onTestEnd(test, result) {
    const file = relative(process.cwd(), test.location.file).replace(/\\/g, '/');
    const row = this.files.get(file) || { pass: 0, fail: 0, flaky: 0, skip: 0, ms: 0 };
    row.ms += result.duration;
    const outcome = test.outcome();                 // expected | unexpected | flaky | skipped (after retries)
    if (result.retry === test.retries || outcome === 'skipped' || result.status === 'passed' || result.status === 'skipped') {
      if (outcome === 'unexpected') {
        row.fail++;
        const message = stripAnsi(result.error && result.error.message).split('\n').filter(Boolean).slice(0, 12).join('\n');
        this.failures.push({ file, title: test.title, message });
      } else if (outcome === 'flaky') row.flaky++;
      else if (outcome === 'skipped') row.skip++;
      else row.pass++;
    }
    this.files.set(file, row);
  }

  onEnd(result) {
    if (!process.env.GITHUB_STEP_SUMMARY) return;
    const total = [...this.files.values()].reduce((t, r) => ({ pass: t.pass + r.pass, fail: t.fail + r.fail, flaky: t.flaky + r.flaky, skip: t.skip + r.skip }), { pass: 0, fail: 0, flaky: 0, skip: 0 });
    const lines = [
      `## ${total.fail ? '❌' : '✅'} Browser tests: ${total.pass + total.flaky} passed, ${total.fail} failed${total.flaky ? ` (${total.flaky} flaky)` : ''}${total.skip ? `, ${total.skip} skipped` : ''}`,
      '',
      '| File | Passed | Failed | Test time |',
      '| --- | ---: | ---: | ---: |',
      ...[...this.files].sort().map(([f, r]) => `| \`${f}\` | ${r.pass + r.flaky} | ${r.fail ? `**${r.fail}**` : 0} | ${(r.ms / 1000).toFixed(1)} s |`),
    ];
    if (this.failures.length) {
      lines.push('', '### Failures');
      for (const f of this.failures) lines.push('', `**${f.title}** (\`${f.file}\`)`, '', '```', f.message, '```');
      lines.push('', 'The full report and traces are attached to this run as the `playwright-report` artifact.');
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}
