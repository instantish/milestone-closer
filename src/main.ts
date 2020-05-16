import { MilestoneProcessorOptions } from './interfaces';
import * as core from '@actions/core';
import { MilestoneProcessor } from './MilestoneProcessor';

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
  const args = {
    repoToken: core.getInput('repo-token', { required: true }),
    minimumIssues: core.getInput('minimum-issues') as unknown as number,
    relatedOnly: core.getInput('related-only') === 'true',
    relatedActive: core.getInput('related-active') === 'true',
    reopenActive: core.getInput('reopen-active') === 'true',
    debugOnly: core.getInput('debug-only') === 'true',
  };
  return args;
}

run();
