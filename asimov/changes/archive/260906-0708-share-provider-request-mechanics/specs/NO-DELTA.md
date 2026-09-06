# No spec delta

Behaviour-preserving extraction of the preview/vault request mechanics shared by
`TerminalEditorProvider` and `TerminalViewProvider`. Each provider posts the same messages, in
the same order, with the same retry behaviour and the same answers on a disposed webview, so no
externally verifiable behaviour and no externally mandated constraint changes.
