# Portable cards

The presentation module provides a portable card package, WebGL2 player, authoring API and creator studio. A .dcard file contains a manifest, scenes, media and an integrity index. Editable projects and issued ownership records are separate from the presentation file.

## Guides

- [Runtime setup and lifecycle](runtime.md)
- [Creator API and source import](creator-api.md)
- [Custom effects, performance and integration](customization-and-safety.md)
- [Supported capabilities and limits](implementation-status.md)
- [Identity and access](../access-and-identity.md)
- [API types](contracts.d.ts)
- [Schema examples](examples/README.md)

Use public APIs to embed a card in a host page, opener or album. Keep original art in external storage. Issued copies pin presentation references; changing a catalog does not rewrite already issued copies.

The runtime API is experimental. Pin compatible versions and check the supported import/media profiles before selecting an adapter. A static editor demo does not provide authoritative catalog publishing, identity or ownership services.
