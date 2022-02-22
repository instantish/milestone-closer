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
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

function getAndValidateArgs(): MilestoneProcessorOptions {
  const args: MilestoneProcessorOptions = {
    repoToken: core.getInput('repo-token', {required: true}),
    debugOnly: core.getInput('debug-only') === 'true',
    minIssues: Number(core.getInput('min-issues', {required: true}))
  };

  if (!Number.isInteger(args.minIssues) || args.minIssues < 0)
    throw `'${core.getInput(
      'min-issues'
    )}' is not a valid value for the 'min-issues' input, choose a non-negative integer.`;

  return args;
}

run();
