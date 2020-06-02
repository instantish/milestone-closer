import * as core from '@actions/core';
import * as github from '@actions/github';
import {Octokit} from '@octokit/rest';
import { Context } from '@actions/github/lib/context';
import { WebhookPayload } from '@actions/github/lib/interfaces';

type OctoKitIssueList = Octokit.Response<Octokit.IssuesListForRepoResponse>;
type OctoKitMilestoneList = Octokit.Response<
  Octokit.IssuesListMilestonesForRepoResponse
>;

const OPERATIONS_PER_RUN = 100;
// TODO: Expose as option.
const MIN_ISSUES_IN_MILESTONE = 3;

export interface Issue {
  title: string;
  number: number;
  updated_at: string;
  labels: Label[];
  pull_request: any;
  state: string;
  locked: boolean;
}

export interface Milestone {
  id: number;
  title: string;
  number: number;
  updated_at: string;
  description: string;
  open_issues: number;
  closed_issues: number;
  state: string;
}

export interface Label {
  name: string;
}

export interface MilestoneProcessorOptions {
  repoToken: string;
  reopenActive: boolean;
  debugOnly: boolean;
}

/***
 * Handle processing of issues for staleness/closure.
 */
export class MilestoneProcessor {
  readonly client: github.GitHub;
  readonly options: MilestoneProcessorOptions;
  private operationsLeft: number = 0;
  private relatedNotFound: boolean = false;

  readonly staleIssues: Issue[] = [];
  readonly closedIssues: Issue[] = [];
  readonly closedMilestones: Milestone[] = [];
  readonly reopenedMilestones: Milestone[] = [];

  constructor(
    options: MilestoneProcessorOptions,
    getMilestones?: (page: number) => Promise<Milestone[]>
  ) {
    this.options = options;
    this.operationsLeft = OPERATIONS_PER_RUN;
    this.client = new github.GitHub(options.repoToken);

    if (getMilestones) {
      this.getMilestones = getMilestones;
    }

    if (this.options.debugOnly) {
      core.warning(
        'Executing in debug mode. Debug output will be written but no milestones will be processed.'
      );
    }
  }

  async processMilestones(page: number = 1): Promise<number> {
    if (this.operationsLeft <= 0) {
      core.warning('Reached max number of operations to process. Exiting.');
      return 0;
    }

    // get the next batch of milestones
    const milestones: Milestone[] = await this.getMilestones(page);
    this.operationsLeft -= 1;

    if (milestones.length <= 0 && !this.options.reopenActive) {
      core.debug('No more milestones found to process. Exiting.');
      return this.operationsLeft;
    }

    if (this.operationsLeft < (OPERATIONS_PER_RUN - 1) && !this.options.reopenActive) {
      core.debug('Passing milestone last check. Exiting.');
      return this.operationsLeft;
    }

    // for later prep: to add "this.eventPullRequest" for PR
    if (this.relatedNotFound && !this.options.reopenActive) {
      core.debug('Related Milestone not found. While related-only is enabled. Exiting.');
      return this.operationsLeft;
    }

    for (const milestone of milestones.values()) {
      const totalIssues = milestone.open_issues + milestone.closed_issues;
      const {number, title} = milestone;
      const updatedAt = milestone.updated_at;
      const openIssues = milestone.open_issues;

      core.debug(`Found milestone: #${number} - "${title}", last updated: ${updatedAt}`);

      // Open closed open milestone
      if (milestone.state === "closed" && this.options.reopenActive && openIssues > 0) {
        await this.openMilestone(milestone);
        continue;
      }

     if (totalIssues < MIN_ISSUES_IN_MILESTONE) {
        core.debug(
          `Skipping ${title} because it has less than ${MIN_ISSUES_IN_MILESTONE} issues`
        );
        continue;
      }

      if (milestone.state === "open" && openIssues > 0) {
        core.debug(`Skipping milestone: "${title}" because it has open issues/prs`);
        continue;
      }

      // Close open milestone instantly because there isn't a good way to tag milestones
      // and do another pass.
      if (milestone.state === "open") {
        await this.closeMilestone(milestone);
      }
    }

    // do the next batch
    return this.processMilestones(page + 1);
  }

  private getCheckPullRequest = (context: Context): boolean => 'pull_request' === context.eventName;

  private getCheckPush = (context: Context): boolean => 'push' === context.eventName;

  private emptyObject(object: Object | Array<any>): boolean {
    if (object instanceof Array) {
      return object === undefined || object.length == 0;
    } else {
      return Object.keys(object).length <= 0;
    }
  };

  // Get issues from github in baches of 100
  private async getMilestones(page: number): Promise<Milestone[]> {

    const currentPayload: WebhookPayload | any = github.context.payload;
    let milestonesResult: Milestone[] = [];
    let allClosedMilestoneResultValues: Milestone[] = [];

  core.debug("Getting all Milestones");
  const allMilestoneResult: OctoKitMilestoneList = await this.client.issues.listMilestonesForRepo({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    state: 'open',
    per_page: 100,
    page
  });

  if (this.options.reopenActive) {
    const allClosedMilestoneResult = await this.client.issues.listMilestonesForRepo({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      state: 'closed',
      per_page: 100,
      page
    });
    allClosedMilestoneResultValues = allClosedMilestoneResult.data;
  }

  milestonesResult = [...new Set([...allMilestoneResult.data, ...allClosedMilestoneResultValues])];


    // core.debug(JSON.stringify(milestonesResult));
    return milestonesResult;
  }

  /// Reopen a milestone
  private async openMilestone(milestone: Milestone): Promise<void> {

    core.info(`Reopening closed milestone #${milestone.number} - "${milestone.title}" (${this.options.debugOnly}) for detected activity`);

    this.reopenedMilestones.push(milestone);

    if (this.options.debugOnly) {
      return;
    }

    await this.client.issues.updateMilestone({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      milestone_number: milestone.number,
      state: 'open'
    });
  }

  /// Close an milestone
  private async closeMilestone(milestone: Milestone): Promise<void> {
    core.debug(
      `Closing milestone #${milestone.number} - ${milestone.title} for being stale`
    );

    this.closedMilestones.push(milestone);

    if (this.options.debugOnly) {
      return;
    }

    await this.client.issues.updateMilestone({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      milestone_number: milestone.number,
      state: 'closed'
    });
  }
}
