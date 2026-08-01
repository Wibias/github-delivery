# Fowler code-smell baseline

This fixed smell set supplements the documented repository standards during the Standards axis of a full review. It is useful when the repository has little or no design guidance, but it never outranks repository-specific decisions.

**Two binding rules:**

- **Repo standards override.** A documented repository standard, ADR, or accepted local convention wins. Suppress a smell when the repository explicitly endorses the design.
- **Always a judgement call.** Every smell is a labelled heuristic such as “possible Feature Envy”, never a hard violation by itself. Skip anything tooling already enforces, and require concrete diff evidence before reporting it.

## Smell table

| Smell | What it is | Typical correction |
| --- | --- | --- |
| **Mysterious Name** | A function, variable, or type whose name does not reveal what it does or holds. | Rename it; when no honest name fits, inspect the underlying design. |
| **Duplicated Code** | The same logic shape appears in more than one changed hunk or file. | Extract the shared behavior and call it from both sites. |
| **Feature Envy** | A method reaches into another object’s data more than its own. | Move the behavior closer to the data it uses. |
| **Data Clumps** | The same small group of fields or parameters repeatedly travels together. | Give the group a named type or object. |
| **Primitive Obsession** | A primitive or string represents a domain concept that needs validation or behavior. | Introduce a small domain type where that reduces ambiguity. |
| **Repeated Switches** | The same `switch` or `if` cascade over the same kind recurs across the change. | Centralize the mapping or use a suitable polymorphic design. |
| **Shotgun Surgery** | One logical change requires scattered edits across many modules. | Gather the changing responsibility behind one boundary. |
| **Divergent Change** | One module is edited for several unrelated reasons. | Split responsibilities so each module changes for a coherent reason. |
| **Speculative Generality** | Abstractions, parameters, hooks, or extension points exist for needs the spec does not have. | Remove or inline them until a concrete requirement exists. |
| **Message Chains** | A caller navigates a long `a.b().c().d()` chain and depends on remote structure. | Hide the navigation behind a stable method or boundary. |
| **Middle Man** | A class or function mostly delegates without adding a useful policy boundary. | Call the real target directly unless the boundary has a documented purpose. |
| **Refused Bequest** | A subclass or implementation ignores or overrides most inherited behavior. | Prefer composition or a narrower interface. |

## Reporting contract

- Cite the changed file and hunk or symbol.
- Label the item as a possible smell, not a standards violation, unless a repository rule independently makes it one.
- Explain the concrete maintenance or correctness cost in this diff.
- Do not report style preferences, theoretical future problems, or tooling-enforced issues.

Source basis: Martin Fowler, _Refactoring_, chapter 3. Adapted from the MIT-licensed `mattpocock/skills` code-review smell baseline on 2026-07-10.
