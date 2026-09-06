# 260906-at-create-dialog-resolves-an-empty-name

Supersedes `260906-at-create-dialog-blur-from-autofocus`.

Reported: "giờ nó chỉ hết đỏ ô input thôi, còn hint ở dưới vẫn đổi thành …/worktrees/cyberk-skills-2
… cyberk-skills already exists, so this is created as cyberk-skills-2. Creates a new branch here.
Clear existing folder and create here: cyberk-skills … is not a git checkout. Accepting clears it
before the worktree is created."

## Root cause

`askForDestination()` asked about whatever `selection()` reported, with no test that the selection
named anything. The previous session stopped the form from PRINTING git's refusal of `""`, but the
question was still going out — so the host answered for the empty name with a full plan, and the
form drew it: a free suffixed path, the collision it stepped around, and an offer to clear a
folder that is not a checkout.

Two fixes, one fault, half moved. The earlier session's own notes recorded the ask as deliberate —
"the form needs the destination path from the same answer. Only the message waits, not the
question" — and that reasoning was wrong. There is no destination to resolve for a create with no
target; the seeded line already says what the form knows, as a template rather than as a decision.

`askForDestination` now returns early while the create has no target (the branch, or the base ref
under detached).

## What this changes beyond the report

git is no longer asked about an empty name at all, so the red `git will not take "" as a branch
name.` can no longer appear from any path. What the user sees for an unnamed create is the form's
own "Enter a branch name.", once they have used the field. A refusal of a name they DID type is
unaffected and still arrives from the host.

## What it did not settle

- Switching repository with an empty field no longer sends a defaults request. The per-repo seed
  in `repos` is what the destination line shows until something is named, and the request fires on
  the first keystroke. No user-visible gap was found, but this is the one behaviour outside the
  report that moved.

## Which defensive layer should have caught this

The previous session's repro. It asserted the message and the field marking, and stopped there —
so a fix that silenced the message while leaving the question in flight passed it. A repro for
"the form says something it should not" has to cover what the form DREW, not only the sentence
that was complained about. Its own guard was worse: it emptied the field before asserting that a
typed name is refused, so its title and its body disagreed, and it certified the empty-name
refusal as a contract.

## Sweep

`askForDestination` is the only caller path into the resolution channel; no sibling site asks the
host about an unnamed create.
