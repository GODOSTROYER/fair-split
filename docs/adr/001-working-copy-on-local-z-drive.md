# ADR 001: Working copy on the local Z: drive

- **Status:** Proposed (awaiting the user's acceptance)
- **Date:** 22 Oct 2026 (IST)
- **Author:** WS-QA
- **Touches:** register §1 (Repo row), architecture §18 (Windows development), S5.2.3 rule 1 (worktree paths)

## Context

The register says the working copy lives at `C:\fs\fair-split`, "never on a mapped drive", and architecture §18
says to clone to `C:\fs` or a Dev Drive. S5.2.3 puts worktrees at `Z:\fs-wt\<ws>`.

The user has restricted all work to `Z:\Projects\Paypal`. The repository is at `Z:\Projects\Paypal\fair-split` and
the workstream worktrees are at `Z:\Projects\Paypal\fs-wt\<ws>`.

The rule against mapped drives exists because network drives break file watching (Metro, Vite), symlinks and
junctions (pnpm), and long paths. Z: is not a mapped drive. Checked on 22 Oct 2026:

| Check                                    | Result                                         |
| ---------------------------------------- | ---------------------------------------------- |
| `Win32_LogicalDisk` `DriveType` for Z:   | `3` (local fixed disk; a network drive is `4`) |
| File system                              | NTFS                                           |
| `ProviderName` (UNC target of a mapping) | empty                                          |
| `HKLM\...\FileSystem\LongPathsEnabled`   | `1`                                            |
| `git config core.longpaths`              | `true`                                         |

## Decision

1. The canonical working copy is `Z:\Projects\Paypal\fair-split`. Worktrees are `Z:\Projects\Paypal\fs-wt\<ws>`
   on branch `ws/<ws>`.
2. The register's intent stands unchanged: never a mapped or network drive, NTFS (or a Dev Drive), long paths on,
   and the pnpm store on the same volume as the working copy, with `nodeLinker: hoisted`.
3. Local secrets that the specs place at `C:\fs\.env.local` or `Z:\fs\.env.local` live in the gitignored `.env`
   of the working copy instead (AGENTS.md).
4. Documents and scripts write paths relative to the repository root, never with a drive letter.

## Consequences

- No code change. README, CONTRIBUTING and AGENTS.md describe the repository root, not a fixed path.
- If Z: ever becomes a mapped or removable drive, this ADR no longer holds; move the working copy and supersede it.
- DR-4 (clean clone on a new Windows user) still tests a fresh clone under `C:\`, so both locations are covered.

## Alternatives considered

| Option                     | Why not                                                         |
| -------------------------- | --------------------------------------------------------------- |
| Move to `C:\fs\fair-split` | The user restricted all work to `Z:\Projects\Paypal`            |
| A Dev Drive (ReFS) on Z:   | Needs reformatting; NTFS with long paths already meets the rule |
