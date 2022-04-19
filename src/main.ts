import * as core from '@actions/core';
import {
  MilestoneProcessor,
  MilestoneProcessorOptions
} from './MilestoneProcessor';

async function run(): Promise<void> {
  try {
    const args = getAndValidateArgs();

    const processor: MilestoneProcessor = new MilestoneProcessor(args);
    await processor.processMilestones();
  } catch (error: any) {
    core.error(error);
    core.setFailed(error.message);
  }
}

function getAndValidateArgs(): MilestoneProcessorOptions {
  const args: MilestoneProcessorOptions = {
    debugOnly: core.getBooleanInput('debug-only', {required: true}),
    minIssues: Number(core.getInput('min-issues', {required: true})),
    reopenActive: core.getBooleanInput('reopen-active', {required: true}),
    repoToken: core.getInput('repo-token', {required: true})
  };

  if (!Number.isInteger(args.minIssues) || args.minIssues < 0)
    throw new Error(
      `'${core.getInput(
        'min-issues'
      )}' is not a valid value for the 'min-issues' input, choose a non-negative integer.`
    );

  return args;
}

run();
