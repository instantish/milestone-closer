import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import { Context } from '@actions/github/lib/context';
import { WebhookPayload } from '@actions/github/lib/interfaces';
import { MilestoneProcessorOptions, Issue, Milestone, ActionEvent } from './interfaces';

type OctoKitPullsList = Octokit.Response<Octokit.PullsListResponse>;
type OctoKitIssuesList = Octokit.Response<Octokit.IssuesListForRepoResponse>;
type OctoKitMilestoneList = Octokit.Response<Octokit.IssuesListMilestonesForRepoResponse>;
type OctoKitCommitsPullsList = Octokit.Response<Octokit.ReposListPullRequestsAssociatedWithCommitResponse>;

const OPERATIONS_PER_RUN = 100;

/***
 * Handle processing of issues for staleness/closure.
 */
export class MilestoneProcessor {
  readonly client: github.GitHub;
  readonly options: MilestoneProcessorOptions;
  readonly staleIssues: Issue[] = [];
  readonly closedIssues: Issue[] = [];
  readonly closedMilestones: Milestone[] = [];
  readonly reopenedMilestones: Milestone[] = [];
  readonly closedEvents: ActionEvent[] = [];

  private operationsLeft: number = 0;
  private relatedNotFound: boolean = false;
  private detectedEvent: string | undefined = "none";
  private eventPullRequest: boolean = false;
  private eventPush: boolean = false;

  constructor(
    options: MilestoneProcessorOptions,
    getMilestones?: (page: number) => Promise<Milestone[]>,
  ) {
    this.options = options;
    this.operationsLeft = OPERATIONS_PER_RUN;
    this.client = new github.GitHub(options.repoToken);
    this.detectedEvent = github.context.eventName;
    this.eventPullRequest = (this.options.debugOnly ? this.options.relatedOnly : this.getCheckPullRequest(github.context));
    this.eventPush = (this.options.debugOnly ? this.options.relatedOnly : this.getCheckPush(github.context));

    if (getMilestones) {
      this.getMilestones = getMilestones;
    }

    if (this.options.debugOnly) {
      core.warning('Executing in debug mode. Debug output will be written but no milestones will be processed.');
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

    if ((this.options.relatedOnly || this.options.relatedActive) && this.operationsLeft < (OPERATIONS_PER_RUN - 1) && !this.options.reopenActive) {
      core.debug('Passing milestone last check. Exiting.');
      return this.operationsLeft;
    }

    // for later prep: to add "this.eventPullRequest" for PR
    if ((this.options.relatedOnly || this.options.relatedActive) && this.relatedNotFound && !this.options.reopenActive) {
      core.debug('Related Milestone not found. While related-only is enabled. Exiting.');
      return this.operationsLeft;
    }

    for (const milestone of milestones.values()) {
      const totalIssues = milestone.open_issues + milestone.closed_issues;
      const { number, title } = milestone;
      const updatedAt = milestone.updated_at;
      const openIssues = milestone.open_issues;

      core.debug(`Found milestone: #${number} - "${title}", last updated: ${updatedAt}`);

      // Open closed open milestone
      if (milestone.state === "closed" && this.options.reopenActive && openIssues > 0) {
        await this.openMilestone(milestone);
        continue;
      }

      if (totalIssues < this.options.minimumIssues) {
        core.debug(`Skipping milestone: "${title}" because it has less than: ${this.options.minimumIssues} issues`);
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
    let milestonesSelfResult: Milestone[] = [];
    let milestonesPullsResult: Milestone[] = [];
    let milestonesIssuesResult: Milestone[] = [];
    let allClosedMilestoneResultValues: Milestone[] = [];

    // Checks if related-only is true
    // for later prep: (if this is a pull request to get the milestone specified)
    if (this.options.relatedOnly || this.options.relatedActive) {

      if (this.options.relatedOnly) {

        // Get self Milestone
        core.debug("Getting self Milestone...");

        // it never gets here because of how prs & commits works
        // if (this.eventPullRequest) {
        //   if (!this.emptyObject(currentPayload.pull_request) && !this.emptyObject(currentPayload.pull_request.milestone)) {
        //     milestonesSelfResult.push(currentPayload.pull_request.milestone);
        //   }
        // }

        if (this.eventPush) {
          // to check if need to keep or remove the action on all prs or just the first one
          const commitResult: OctoKitCommitsPullsList = await this.client.repos.listPullRequestsAssociatedWithCommit({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            commit_sha: github.context.sha,
          });
          core.debug(JSON.stringify(commitResult));

          if (!this.emptyObject(commitResult.data)) {
            commitResult.data.forEach((pr: any) => {
              if (!this.emptyObject(pr.milestone)) {
                milestonesSelfResult.push(pr.milestone);
              }
            });
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

      milestonesResult = [...new Set([...milestonesSelfResult, ...milestonesPullsResult, ...milestonesIssuesResult])];

    } else {

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

    }

    // core.debug(JSON.stringify(milestonesResult));
    return milestonesResult;
  }

  private packMilestones(milestonesContentList: OctoKitPullsList | OctoKitIssuesList): Milestone[] {
    let milestones: Milestone[] = [];
    milestonesContentList.data.forEach((list: any) => {
      const milestone = list.milestone;
      milestones.push(milestone);
    });
    return milestones;
  }

  private async getAllMilestones(page: number): Promise<OctoKitMilestoneList> {
    core.debug("Getting all Milestones");
    const allMilestoneResult: OctoKitMilestoneList = await this.client.issues.listMilestonesForRepo({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      state: 'open',
      per_page: 100,
      page
    });
    return allMilestoneResult;
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

  /// Close a milestone
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
