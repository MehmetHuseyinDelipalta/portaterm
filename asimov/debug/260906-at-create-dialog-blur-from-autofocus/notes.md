# 260906-at-create-dialog-blur-from-autofocus

Supersedes `260906-at-create-dialog-errors-before-touch`.

Reported: "vẫn bị mà, mày lừa à — click vào 'Run setup' checkbox là báo lỗi?", with a screenshot
showing the red `git will not take "" as a branch name.` under an empty Branch name field.

## Root cause

`shell.focusInitial(nameInput)` (`WorktreeCreateDialog.ts:3777`) puts the caret in Branch name
when the form opens. So the FIRST click anywhere in the dialog blurs that field, and the blur
handler does two things: it asks the host (`syncDerived(true)` → `askForDestination()`), and — as
of the superseded session — it marked the field as one the user had left.

The host answers honestly: `""` is not a name git will take. The form then printed that verdict
against a field nobody had typed in.

The previous session's gate was not missing; it fired. `nameLeft` was set by the very blur the
click caused, so "the user left this field empty" was true for a caret the FORM had placed. The
gate needed a stronger predicate, not a different one.

`nameTyped` / `baseTyped` are now what earn it: leaving a field the user actually put something in
is their answer; leaving the one the form focused for them is not. A ⌘↵ create attempt still
earns it too.

## Where the first session went wrong

Both of its eliminations were reached from probes that could not have shown the fault:

- The fixture (`createDefaults()`) carries no provision offer, so the "Run setup" checkbox the
  reporter clicked did not exist in the probe at all. The three checkboxes that did exist do not
  settle, so nothing asked the host.
- The probe wired `bindDefaults`, but the branch verdict rides `bindResolution`. `effective` was
  therefore never set, and `branchValid` could not speak however the form was driven.

So "the host's branch verdict paints the red `.wt-ferror`" was eliminated on the strength of a
harness that had no way to deliver it. The grey `disabled-reason` line the probe DID measure is a
real second issue, and the superseded session's fix for it stands — but it was never what the
screenshot showed.

The lesson is about the instrument, not the reasoning: an elimination is only as strong as the
probe's ability to have observed the thing being eliminated. Neither probe was checked for that.

## What it did not settle

- The reported gesture is reproduced by a bare blur, with no control clicked. Whether every
  control in the real dialog blurs the field is a browser fact this repro does not exercise;
  it does not need to, because blur is the mechanism either way.
- The ask still goes out for an empty branch — the form needs the destination path from the same
  answer. Only the message waits, not the question.

## Which defensive layer should have caught this

A test, and one existed one session earlier — but with the wrong precondition. Its guard did a
bare `focus()` + `blur()` and called that "the user has been in the field", which is exactly the
form-placed caret. A test that stands in for a user gesture has to model what the gesture actually
does, or it certifies the defect.

## Sweep

`focusInitial` is called by the create dialog only; the remove, launch, prune and agent dialogs
carry no field whose emptiness is refused, so no sibling site exists.
