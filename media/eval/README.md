# media/eval — eval labels (IC-11)

Written by `imagegen labels` from checked fixtures; never edited by hand. One file per case, in one of two
folders, both in the shape of `label.schema.json` (`urn:fairsplit:ic-11:eval-label:v1`), which is exactly
what WS-READ's strict loader parses (`packages/eval/src/labels.ts`).

| Folder                    | Holds                                                    | The eval                                                                         |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `labels/{case}.json`      | Labels a person checked (`human-reviewed` fixture, C-24) | Scores them by default (`cases.ts`)                                              |
| `provisional/{case}.json` | Labels only an agent checked (`agent-checked` fixture)   | Only with `--labels <repo>/media/eval/provisional`; such a report is provisional |

A label leaves `provisional/` for `labels/` when the user reviews its fixture (`imagegen review`), and goes
back if only an agent checks a replacement. Each label names its fixture (`fixture`), which records
`review.status` and `synthetic: true` (I8). Every case is a synthetic Codex image.
