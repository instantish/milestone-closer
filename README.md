# Close milestones that are done

Automatically closes milestones that have more than 3 issues/prs and all issues/prs are marked closed.

### Building and testing

Install the dependencies
```bash
$ npm install
```

Build the typescript and package it for distribution
```bash
$ npm run build && npm run pack
```

Run the tests :heavy_check_mark:
```bash
$ npm test
```

### Usage

See [action.yml](./action.yml) For comprehensive list of options.

Basic:
```yaml
name: "Close finished milestones"
on:
  schedule:
  - cron: "0 0 * * *"

jobs:
  milestone-closer:
    runs-on: ubuntu-latest
    steps:
    - uses: instantish/milestone-closer@v1.1.0
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
```

### Debugging

To see debug ouput from this action, you must set the secret `ACTIONS_STEP_DEBUG` to `true` in your repository. You can run this action in debug only mode (no actions will be taken on your issues) by passing `debug-only` `true` as an argument to the action.

### More Resources

For more resources or tools to make issue tracking easier, check out [Instantish](https://itsinstantish.com) ⚡️

If you have questions about setting this up, feel free to reach out to hi@itsinstantish.com with subject line "Question about GitHub Action" 😊

