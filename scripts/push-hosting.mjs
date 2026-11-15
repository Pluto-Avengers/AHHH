// Sends the code committed on `main` to the hosting repo, whose `main` branch Vercel builds the website from.
//
//   npm run push:hosting                 build, then push main to the hosting repo
//   npm run push:hosting -- --dry-run    show what would be sent, push nothing
//   npm run push:hosting -- --no-build   skip the build check
//   npm run push:hosting -- --overwrite  replace changes made directly on the hosting repo
//
// The hosting repo has its own history (files uploaded on GitHub), so main can't be pushed there as is.
// This makes one commit on the local `hosting` branch whose files are exactly main's, with the hosting
// repo's latest commit as its parent, and pushes it. The same code runs locally and on Vercel (see
// "Hosting" in README.md), so nothing has to be changed for hosting.
import { execFileSync } from 'node:child_process'

const REMOTE = 'hosting'
const REMOTE_URL = 'https://github.com/Pluto-Avengers/mars-positioning-system.git'
const REMOTE_BRANCH = process.env.HOSTING_BRANCH || 'main' // the branch Vercel deploys
const LOCAL_BRANCH = 'hosting'
const SOURCE = 'main'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const overwrite = args.has('--overwrite')

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGit = (...a) => {
  try {
    return git(...a)
  } catch {
    return null
  }
}
const fail = (msg) => {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

// 1. The hosting repo as a remote, and the local `hosting` branch set to push to its main
if (!tryGit('remote', 'get-url', REMOTE)) git('remote', 'add', REMOTE, REMOTE_URL)
console.log(`Fetching ${REMOTE}/${REMOTE_BRANCH} ...`)
git('fetch', '--quiet', REMOTE, REMOTE_BRANCH)
const remoteRef = `refs/remotes/${REMOTE}/${REMOTE_BRANCH}`
const remoteTip = git('rev-parse', remoteRef)

// 2. Only committed work is sent
const dirty = git('status', '--porcelain')
if (dirty) {
  fail(
    `These changes aren't committed, so they wouldn't reach the website:\n${dirty}\n\n` +
      `Commit them to ${SOURCE} first (or stash them), then run this again.`,
  )
}
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== SOURCE) fail(`Switch to ${SOURCE} first (git checkout ${SOURCE}).`)

const sourceTree = git('rev-parse', `${SOURCE}^{tree}`)
if (sourceTree === git('rev-parse', `${remoteRef}^{tree}`)) {
  console.log(`The hosting repo already has exactly what's on ${SOURCE}. Nothing to push.`)
  process.exit(0)
}

// 3. Did someone change the hosting repo since the last push from here (e.g. files uploaded on GitHub)?
//    Those changes would be replaced by main's files, so list them and ask for --overwrite.
//    Each push from here has main's commit as a parent, so the newest main commit the hosting repo has is
//    the last one sent; anything different on the hosting repo since was changed there.
const lastSent = tryGit('merge-base', SOURCE, remoteTip)
const changedThere = lastSent
  ? git('diff', '--name-status', lastSent, remoteTip)
  : git('diff', '--name-status', SOURCE, remoteTip) // first push: everything that differs
if (changedThere && !overwrite) {
  const lines = changedThere.split('\n')
  fail(
    `The hosting repo has changes that aren't on ${SOURCE} (${lines.length} file${lines.length === 1 ? '' : 's'}):\n` +
      lines.slice(0, 40).join('\n') +
      (lines.length > 40 ? `\n... and ${lines.length - 40} more` : '') +
      `\n\nPushing replaces them with ${SOURCE}'s version. Copy anything you want to keep into ${SOURCE} first,` +
      `\nor run again with --overwrite (npm run push:hosting -- --overwrite).`,
  )
}

// 4. Check that the website builds before anything is sent
if (!args.has('--no-build')) {
  console.log('Building the website to check it compiles ...')
  try {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' })
  } catch {
    fail('The build failed, so nothing was pushed. Fix the errors above and try again.')
  }
}

// 5. One commit with main's files on top of the hosting repo's history
const subject = git('log', '-1', '--format=%s', SOURCE)
const short = git('rev-parse', '--short', SOURCE)
const message = `Update from ${SOURCE} (${short}): ${subject}`
console.log(`\nChanges going to ${REMOTE}/${REMOTE_BRANCH}:`)
console.log(git('diff', '--stat=100', remoteTip, SOURCE) || '(none)')
if (dryRun) {
  console.log('\n--dry-run: nothing was pushed.')
  process.exit(0)
}
const commit = git('commit-tree', sourceTree, '-p', remoteTip, '-p', SOURCE, '-m', message)
git('update-ref', `refs/heads/${LOCAL_BRANCH}`, commit)
git('config', `branch.${LOCAL_BRANCH}.remote`, REMOTE)
git('config', `branch.${LOCAL_BRANCH}.merge`, `refs/heads/${REMOTE_BRANCH}`)
git('config', `branch.${LOCAL_BRANCH}.pushRemote`, REMOTE)
git('config', `remote.${REMOTE}.push`, `refs/heads/${LOCAL_BRANCH}:refs/heads/${REMOTE_BRANCH}`)

console.log(`\nPushing to ${REMOTE_URL} (${REMOTE_BRANCH}) ...`)
try {
  execFileSync('git', ['push', REMOTE, `refs/heads/${LOCAL_BRANCH}:refs/heads/${REMOTE_BRANCH}`], { stdio: 'inherit' })
} catch {
  fail('The push failed (see above). If someone pushed to the hosting repo just now, run this again.')
}
console.log(`\nDone. Vercel will now build and deploy ${REMOTE_BRANCH} (usually 1-2 minutes).`)
