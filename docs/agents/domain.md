# Domain docs

## Layout

This repo uses a single-context layout:
- `GLOSSARY.md` at the repository root.
- Architecture decision records in `docs/adr/`.

## Before exploring

Read the glossary and ADRs relevant to the area being explored.

If these files do not exist, proceed silently. Do not suggest creating
them upfront. The domain-modeling skill creates them lazily as terms
and decisions are resolved.

## Vocabulary

Use the glossary's defined terms in issues, proposals, hypotheses,
and test names. Avoid synonyms the glossary explicitly rejects.

If a concept is missing, reconsider whether it belongs in the domain
or note the gap for domain-modeling.

## ADR conflicts

Explicitly flag proposals that contradict an existing ADR.
Name the ADR and explain why its decision should be reconsidered.
