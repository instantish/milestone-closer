import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import { Context } from '@actions/github/lib/context';

type OctoKitIssueList = Octokit.Response<Octokit.IssuesListForRepoResponse>;
type OctoKitMilestoneList = Octokit.Response<
  Octokit.IssuesListMilestonesForRepoResponse
>;
type OctoKitCommitsPullsList = Octokit.Response<Octokit.ReposListPullRequestsAssociatedWithCommitResponse>;

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
  relatedOnly: boolean;
  relatedActive: boolean;
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
  private eventPullRequest: boolean = false;
  private eventPush: boolean = false;

  readonly staleIssues: Issue[] = [];
  readonly closedIssues: Issue[] = [];
  readonly closedMilestones: Milestone[] = [];

  constructor(
    options: MilestoneProcessorOptions,
    getMilestones?: (page: number) => Promise<Milestone[]>
  ) {
    this.options = options;
    this.operationsLeft = OPERATIONS_PER_RUN;
    this.client = new github.GitHub(options.repoToken);
    this.eventPullRequest = (this.options.debugOnly ? this.options.relatedOnly : this.getCheckPullRequest(github.context));
    this.eventPush = (this.options.debugOnly ? this.options.relatedOnly : this.getCheckPush(github.context));

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

    if (milestones.length <= 0) {
      core.debug('No more milestones found to process. Exiting.');
      return this.operationsLeft;
    }

    if ((this.options.relatedOnly || this.options.relatedActive) && this.operationsLeft < (OPERATIONS_PER_RUN - 1)) {
      core.debug('Passing milestone last check. Exiting.');
      return this.operationsLeft;
    }

    // for later prep: to add "this.eventPullRequest" for PR
    if ((this.options.relatedOnly || this.options.relatedActive) && this.relatedNotFound) {
      core.debug('Related Milestone not found. While related-only is enabled. Exiting.');
      return this.operationsLeft;
    }

    for (const milestone of milestones.values()) {
      const totalIssues = milestone.open_issues + milestone.closed_issues;
      const { number, title } = milestone;
      const updatedAt = milestone.updated_at;
      const openIssues = milestone.open_issues;

      core.debug(
        `Found milestone: milestone #${number} - ${title} last updated ${updatedAt}`
      );

      if (totalIssues < MIN_ISSUES_IN_MILESTONE) {
        core.debug(
          `Skipping ${title} because it has less than ${MIN_ISSUES_IN_MILESTONE} issues`
        );
        continue;
      }
      if (openIssues > 0) {
        core.debug(`Skipping ${title} because it has open issues/prs`);
        continue;
      }
      // Close instantly because there isn't a good way to tag milestones
      // and do another pass.
      await this.closeMilestone(milestone);
    }

    // do the next batch
    return this.processMilestones(page + 1);
  }

  private getCheckPullRequest = (context: Context): boolean => 'pull_request' === context.eventName;

  private getCheckPush = (context: Context): boolean => 'push' === context.eventName;

  private emptyObject(object: Object | any[]): boolean {
    if (object instanceof Array) {
      return object === undefined || object.length === 0;
    } else {
      return Object.keys(object).length <= 0;
    }
  };

  // Get issues from github in batches of 100
  private async getMilestones(page: number): Promise<Milestone[]> {

    let milestonesResult: Milestone[] = [];
    const milestonesSelfResult: Milestone[] = [];
    // let milestonesPullsResult: Milestone[] = [];
    // let milestonesIssuesResult: Milestone[] = [];

    // Checks if related-only is true
    // for later prep: (if this is a pull request to get the milestone specified)
    if (this.options.relatedOnly || this.options.relatedActive) {

      if (this.options.relatedOnly) {

        // Get self Milestone
        core.debug("Getting self Milestone...");

        if (this.eventPush) {
          // to check if need to keep or remove the action on all prs or just the first one
          const commitResult: OctoKitCommitsPullsList = await this.client.repos.listPullRequestsAssociatedWithCommit({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            commit_sha: github.context.sha,
          });

          if (!this.emptyObject(commitResult.data)) {
            for (let pr of commitResult.data) {
              if (!this.emptyObject(pr.milestone)) {
                core.debug(JSON.stringify(pr));
              }
            }
          }
        }

      }

      if (this.options.relatedActive) {

        // Get milestones of PRs
        // core.debug("Getting all PRs...");
        // const pullResult: OctoKitPullsList = await this.client.pulls.list({
        //   owner: github.context.repo.owner,
        //   repo: github.context.repo.repo,
        // });
        // if (pullResult && pullResult.data[0]) {
        //   core.debug(JSON.stringify(pullResult));
        //   milestonesPullsResult = this.packMilestones(pullResult);
        // }

        // Get milestones with any issues linked on, to save some unwanted milestone collection
        // core.debug("Getting all Issues with Milestones...");
        // const issuesResult: OctoKitIssuesList = await this.client.issues.listForRepo({
        //   owner: github.context.repo.owner,
        //   repo: github.context.repo.repo,
        //   milestone: "*",
        // });
        // if (issuesResult && issuesResult.data[0]) {
        //   core.debug(JSON.stringify(issuesResult));
        //   milestonesIssuesResult = this.packMilestones(issuesResult);
        // }

      }

      // milestonesResult = [...new Set([...milestonesSelfResult, ...milestonesPullsResult, ...milestonesIssuesResult])];
      milestonesResult = [...new Set([...milestonesSelfResult])];

    } else {

      core.debug("Getting all Milestones");
      const allMilestoneResult: OctoKitMilestoneList = await this.client.issues.listMilestonesForRepo({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        state: 'open',
        per_page: 100,
        page
      });

      milestonesResult = [...new Set([...allMilestoneResult.data])];

    }

    // core.debug(JSON.stringify(milestonesResult));
    return milestonesResult;
  }

  /// Close an milestone
  private async closeMilestone(milestone: Milestone): Promise<void> {

    if (this.eventPullRequest && this.options.relatedOnly) {
      core.info(`Detected relatedOnly and that's a pr! Closing only the related Milestone #${milestone.number} - "${milestone.title}" (${this.options.debugOnly})`);
    } else {
      core.info(`Closing milestone #${milestone.number} - "${milestone.title}" (${this.options.debugOnly}) for being stale`);
    }

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
