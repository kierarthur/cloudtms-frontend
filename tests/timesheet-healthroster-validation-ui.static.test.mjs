import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

test('timesheet modal displays only successful HealthRoster validation as validated', () => {
  assert.match(mainSource, /function getSuccessfulHealthRosterValidation\(details = \{\}\)/);
  assert.match(mainSource, /\['VALIDATION_OK', 'OVERRIDDEN', 'OVERRIDE'\]\.includes\(status\)/);
  assert.match(mainSource, /reason !== 'HEALTHROSTER_DAILY' && reason !== 'HEALTHROSTER_WEEKLY'/);
  assert.match(mainSource, /addStage\(\s*'Validated',\s*'pill-ok'/);
});

test('Daily HealthRoster lines display the saved booking reference', () => {
  assert.match(mainSource, /ts\.reference_number \|\|\s*successfulHealthRosterValidation\?\.hr_request_id/);
  assert.match(mainSource, /Booking Reference Number – <strong>\$\{esc\(bookingReferenceNumber \|\| 'Not recorded'\)\}/);
  assert.doesNotMatch(
    mainSource.slice(
      mainSource.indexOf('if (isDailyElec)'),
      mainSource.indexOf('if (isDailyElec)', mainSource.indexOf('if (isDailyElec)') + 1)
    ),
    /Bucketed hours and pay\/charge for this shift are shown in the Finance tab/
  );
});

