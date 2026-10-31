# Galaxy Chat

A multi-model AI chat application. Anyone can sign up. Replies are paid for with a one-time credit allowance, and after that with the user's own provider key.

## Language

### Paying for replies

**Credits**:
The one-time allowance of 10 granted when a User first signs up. One credit pays for one Reply on a Credit model, made with the Platform key. Credits never renew.
_Avoid_: Quota, budget, balance, tokens

**Credit model**:
A model in the catalog that Credits can pay for. Only cheap, fast models qualify; every other model needs a BYOK key.
_Avoid_: Free model, funded model

**Platform key**:
The operator's provider key, used only to serve replies paid for with Credits.
_Avoid_: Funded inference, platform funding

**BYOK key**:
A provider key that a User saves to their own account. Replies made with it are billed to the User by the provider, not counted against Credits.
_Avoid_: Credential, user key, API key (when ambiguous)

### Chats

**Chat**:
A single conversation between a User and the assistant, made up of Messages.
_Avoid_: Conversation, thread, session

**Message**:
One turn in a Chat, written either by the User or by the assistant. An assistant Message is also called a **Reply**.
_Avoid_: Turn, completion, response (as a noun for stored content)

**Version**:
One of several alternatives at the same point in a Chat. A new Version is created by editing a User Message or regenerating a Reply, and Versions are switched in place.
_Avoid_: Branch, fork, variant

**Temporary chat**:
A Chat that is never saved to history.
_Avoid_: Incognito chat, ephemeral chat

### Generations

**Generation**:
The server-side process that produces one Reply. It keeps going whether or not any browser is watching, and a User who refreshes, reconnects or switches devices rejoins the same Generation.
_Avoid_: Run, stream, job, request

**Stopped**:
A Reply whose Generation the User ended with Stop. It keeps the text produced so far.
_Avoid_: Cancelled, aborted

**Interrupted**:
A Reply whose Generation ended before finishing for a reason other than Stop, such as hitting a time limit. It keeps the text produced so far and can be continued.
_Avoid_: Failed (when partial text exists), timed out
