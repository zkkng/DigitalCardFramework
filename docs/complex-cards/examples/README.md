# Portable card schema examples

The manifest and two scenes in this directory illustrate the runtime schema, asset references and a layered front with a video back. Media paths and hashes are placeholders. This is a structural example, not a distributable card.

Run the schema check from the repository root:

```sh
node docs/complex-cards/check-examples.mjs
```

The check compares the examples and JSON schemas with the runtime validators and requires twelve invalid variants to fail. It does not verify media bytes or rendered appearance.

Use the [creator API](../creator-api.md) to build a card from real assets and the [runtime guide](../runtime.md) to display it.
