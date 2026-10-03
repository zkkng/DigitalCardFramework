import {policyDefinitions} from "./card-policy-schema.js";
// Source for the generated HTTP contract.
export const openapi = {
  "openapi": "3.1.0",
  "info": {
    "title": "Digital Card Framework",
    "version": "0.1.0",
    "description": "Host resolves a verified session to a framework principal; no user identity is accepted from JSON commands. Same-origin writes are required. The demo cookie name is illustrative."
  },
  "servers": [
    {
      "url": "/api"
    }
  ],
  "paths": {
    "/quote": {
      "post": {
        "operationId": "quote",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/QuoteRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Quote"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/purchase": {
      "post": {
        "operationId": "purchase",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Purchase"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/open": {
      "post": {
        "operationId": "openPack",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Open"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Receipt"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/convert": {
      "post": {
        "operationId": "convert",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Convert"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/trade-up": {
      "post": {
        "operationId": "tradeUp",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TradeUp"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Copy"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/albums": {
      "post": {
        "operationId": "saveAlbum",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SaveAlbum"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      },
      "get": {
        "operationId": "albums",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/trades": {
      "post": {
        "operationId": "proposeTrade",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ProposeTrade"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      },
      "get": {
        "operationId": "trades",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/trades/accept": {
      "post": {
        "operationId": "acceptTrade",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TradeCommand"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/trades/cancel": {
      "post": {
        "operationId": "cancelTrade",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TradeCommand"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/bindings/use": {
      "post": {
        "operationId": "consumeBinding",
        "security": [
          {
            "hostSession": []
          }
        ],
        "parameters": [
          {
            "name": "Origin",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UseBinding"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Committed result; repeating the same principal/key/input returns the original result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input"
          },
          "401": {
            "description": "Verified host identity required"
          },
          "403": {
            "description": "Origin/feature/authority rejected"
          },
          "409": {
            "description": "Funds, inventory, supply, quote, version or request-key conflict"
          }
        }
      }
    },
    "/catalog": {
      "get": {
        "operationId": "catalog",
        "security": [],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/me": {
      "get": {
        "operationId": "me",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/wallet": {
      "get": {
        "operationId": "wallet",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/history": {
      "get": {
        "operationId": "history",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/inventory": {
      "get": {
        "operationId": "inventory",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/packs": {
      "get": {
        "operationId": "packs",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/albums/{albumId}": {
      "get": {
        "operationId": "viewAlbum",
        "security": [],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        },
        "parameters": [
          {
            "name": "albumId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ]
      }
    },
    "/cards/{copyId}": {
      "get": {
        "operationId": "inspectCard",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        },
        "parameters": [
          {
            "name": "copyId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ]
      }
    },
    "/public-albums": {
      "get": {
        "operationId": "publicAlbums",
        "security": [],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    },
    "/bindings": {
      "get": {
        "operationId": "bindings",
        "security": [
          {
            "hostSession": []
          }
        ],
        "responses": {
          "200": {
            "description": "Detached view; private fields are filtered for the viewer",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object"
                  }
                }
              }
            }
          },
          "401": {
            "description": "Identity required"
          },
          "403": {
            "description": "Optional feature disabled"
          },
          "404": {
            "description": "Unknown or inaccessible resource"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "hostSession": {
        "type": "apiKey",
        "in": "cookie",
        "name": "host_session",
        "description": "Replace with your verified host session; this adapter does not implement login."
      }
    },
    "schemas": {
      "QuoteRequest": {
        "type": "object",
        "required": [
          "productId"
        ],
        "properties": {
          "productId": {
            "type": "string",
            "minLength": 1
          },
          "quantity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "default": 1
          }
        }
      },
      "Purchase": {
        "type": "object",
        "required": [
          "key",
          "productId",
          "quantity",
          "productRevision",
          "catalogVersion"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "productId": {
            "type": "string",
            "minLength": 1
          },
          "quantity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "productRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "catalogVersion": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        }
      },
      "Open": {
        "type": "object",
        "required": [
          "key",
          "packId"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "packId": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "Convert": {
        "type": "object",
        "required": [
          "key",
          "from",
          "to",
          "amount",
          "catalogVersion"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "from": {
            "type": "string",
            "minLength": 1
          },
          "to": {
            "type": "string",
            "minLength": 1
          },
          "amount": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "catalogVersion": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "rounding": {
            "type": "string",
            "enum": [
              "exact",
              "floor"
            ],
            "default": "exact"
          }
        }
      },
      "TradeUp": {
        "type": "object",
        "required": [
          "key",
          "recipeId",
          "copyIds"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "recipeId": {
            "type": "string",
            "minLength": 1
          },
          "copyIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            },
            "maxItems": 100
          }
        }
      },
      "ProposeTrade": {
        "type": "object",
        "required": [
          "key",
          "toUserId",
          "give",
          "receive"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "toUserId": {
            "type": "string",
            "minLength": 1
          },
          "give": {
            "type": "object",
            "required": [
              "copyIds",
              "currencies"
            ],
            "properties": {
              "copyIds": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                },
                "maxItems": 100
              },
              "currencies": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "currencyId",
                    "amount"
                  ],
                  "properties": {
                    "currencyId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "amount": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 9007199254740991
                    }
                  }
                },
                "maxItems": 20
              }
            }
          },
          "receive": {
            "type": "object",
            "required": [
              "copyIds",
              "currencies"
            ],
            "properties": {
              "copyIds": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1
                },
                "maxItems": 100
              },
              "currencies": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "currencyId",
                    "amount"
                  ],
                  "properties": {
                    "currencyId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "amount": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 9007199254740991
                    }
                  }
                },
                "maxItems": 20
              }
            }
          },
          "expiresInSeconds": {
            "type": "integer",
            "minimum": 1,
            "maximum": 604800,
            "default": 86400
          }
        }
      },
      "TradeCommand": {
        "type": "object",
        "required": [
          "key",
          "tradeId"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "tradeId": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "SaveAlbum": {
        "type": "object",
        "required": [
          "key",
          "name"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "albumId": {
            "type": "string",
            "minLength": 1
          },
          "expectedVersion": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "visibility": {
            "type": "string",
            "enum": [
              "private",
              "public"
            ],
            "default": "private"
          },
          "layout": {
            "type": "object",
            "additionalProperties": true
          },
          "placements": {
            "type": "array",
            "maxItems": 1000,
            "items": {
              "type": "object",
              "required": [
                "copyId"
              ],
              "properties": {
                "copyId": {
                  "type": "string",
                  "minLength": 1
                },
                "position": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 100000
                },
                "data": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          }
        }
      },
      "UseBinding": {
        "type": "object",
        "required": [
          "key",
          "copyId",
          "namespace"
        ],
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "copyId": {
            "type": "string",
            "minLength": 1
          },
          "namespace": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "Error": {
        "type": "object",
        "required": [
          "code",
          "message"
        ],
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1
          },
          "message": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "Quote": {
        "type": "object",
        "required": [
          "productId",
          "quantity",
          "productRevision",
          "catalogVersion",
          "price"
        ],
        "properties": {
          "productId": {
            "type": "string",
            "minLength": 1
          },
          "quantity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "productRevision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "catalogVersion": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "price": {
            "type": "object",
            "required": [
              "currencyId",
              "amount"
            ],
            "properties": {
              "currencyId": {
                "type": "string",
                "minLength": 1
              },
              "amount": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              }
            }
          }
        }
      },
      "Copy": {
        "type": "object",
        "required": [
          "id",
          "ownerId",
          "cardId",
          "variantId",
          "lineId",
          "rarityId",
          "state",
          "definition",
          "variant",
          "bindings",
          "metadata"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "ownerId": {
            "type": "string",
            "minLength": 1
          },
          "cardId": {
            "type": "string",
            "minLength": 1
          },
          "variantId": {
            "type": "string",
            "minLength": 1
          },
          "lineId": {
            "type": "string",
            "minLength": 1
          },
          "rarityId": {
            "type": "string",
            "minLength": 1
          },
          "state": {
            "type": "string",
            "enum": [
              "sealed",
              "owned",
              "consumed"
            ]
          },
          "serialNumber": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1
          },
          "editionTotal": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 1
          },
          "openedBy": {
            "type": [
              "string",
              "null"
            ]
          },
          "openedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "definition": {
            "type": "object"
          },
          "variant": {
            "type": "object"
          },
          "bindings": {
            "type": "object"
          },
          "metadata": {
            "type": "object"
          }
        }
      },
      "Receipt": {
        "type": "object",
        "required": [
          "id",
          "openedAt",
          "cards"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "openedAt": {
            "type": "string",
            "format": "date-time"
          },
          "cards": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Copy"
            }
          }
        }
      }
    }
  }
};

// 0.2 additions share bounded pagination and the same verified-session boundary.
openapi.info.version='0.2.0';
openapi.info.description='Headless card framework. Production host uses verified OIDC sessions, exact-origin JSON writes, X-DC-Principal account binding and immutable trade review. Operator routes are opt-in and require server-derived authority.';
openapi.components.securitySchemes.hostSession={type:'apiKey',in:'cookie',name:'__Host-dc_session',description:'Opaque HttpOnly/Secure cookie issued by the production OIDC host; adapters may replace the session resolver.'};
const schemas=openapi.components.schemas,ref=name=>({$ref:'#/components/schemas/'+name}),str={type:'string'},ids={type:'array',maxItems:1000,uniqueItems:true,items:str};
schemas.Page={type:'object',required:['items','total','next'],properties:{items:{type:'array',maxItems:200,items:{type:'object'}},total:{type:'integer',minimum:0},next:{type:['string','null']}}};
schemas.Preferences={type:'object',properties:{inventoryVisibility:{enum:['private','traders','public']},favoriteCopyIds:ids,wishlistCardIds:ids,blockedUserIds:ids}};
schemas.PreferencesCommand={...schemas.Preferences,required:['key'],properties:{...schemas.Preferences.properties,key:{type:'string',maxLength:128,minLength:1}}};
schemas.Me={type:'object',required:['userId','displayName','preferences','role'],properties:{userId:str,displayName:str,preferences:ref('Preferences'),role:{enum:['player','admin']},permissions:{type:'array',items:{type:'string'}}}};
schemas.Notification={type:'object',required:['id','type','at','read'],properties:{id:str,type:str,at:{type:'string',format:'date-time'},read:{type:'boolean'},data:{type:'object'}}};
schemas.ReadNotifications={type:'object',required:['key','ids'],properties:{key:str,ids:{...ids,maxItems:200}}};
schemas.CatalogManifest={type:'object',required:['version','currencies','lines','rarities','cards','variants','products'],properties:{version:{type:'integer',minimum:1},features:{type:'object',additionalProperties:{type:'boolean'}},...Object.fromEntries(['currencies','lines','rarities','cards','variants','products','recipes','combinations','displayFields'].map(key=>[key,{type:'array',maxItems:20000,items:{type:'object',required:['id'],properties:{id:str}}}])),metadataSchemas:{type:'object',description:'Bounded local schema subset for card metadata, variant metadata and stats; no external refs, regex or executable tags.'}}};
schemas.ImportPreviewRequest={type:'object',required:['source','expectedVersion'],properties:{source:{oneOf:[{type:'string',maxLength:8388608},{type:'object'}]},format:{enum:['json','yaml'],default:'json'},mode:{enum:['merge','replace'],default:'merge'},expectedVersion:{type:'integer',minimum:0}}};
schemas.ImportPreview={type:'object',required:['manifest','digest','expectedVersion','changes','counts','warnings'],properties:{manifest:ref('CatalogManifest'),digest:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedVersion:{type:'integer'},changes:{type:'array',items:{type:'object',required:['section','id','action'],properties:{section:str,id:str,action:{enum:['add','update','remove']}}}},counts:{type:'object'},warnings:{type:'array',items:{type:'object',required:['path','message'],properties:{path:str,message:str}}}}};
schemas.ImportCommit={type:'object',required:['key','manifest','digest','expectedVersion'],properties:{key:{type:'string',minLength:1,maxLength:128},manifest:ref('CatalogManifest'),digest:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedVersion:{type:'integer',minimum:0}}};
schemas.TradeCommand.properties.expectedDigest={type:'string',description:'Required by production review policy; SHA-256 digest of the immutable offer.'};
schemas.ProposeTrade.properties.message={type:'string',maxLength:500};schemas.ProposeTrade.properties.versions={type:'object',additionalProperties:{type:'integer',minimum:1}};
schemas.CounterTrade={...schemas.ProposeTrade,required:['key','tradeId','give','receive'],properties:{...schemas.ProposeTrade.properties,tradeId:str,expectedDigest:str}};
const pageParameters=[{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200,default:50}},{name:'after',in:'query',schema:str},{name:'search',in:'query',schema:{type:'string',maxLength:100}},{name:'sort',in:'query',schema:{enum:['newest','name']}}];
function route(method,operationId,responseSchema,{requestSchema,parameters=[],description='Verified account API',publicRead=false}={}){return {[method]:{operationId,description,security:publicRead?[]:[{hostSession:[]}],parameters:[...parameters,...(method==='post'?[{name:'Origin',in:'header',required:true,schema:str},{name:'X-DC-Principal',in:'header',schema:str,description:'Required by the production host; must match the verified session principal.'}]:[])],...(requestSchema?{requestBody:{required:true,content:{'application/json':{schema:requestSchema}}}}:{}),responses:{'200':{description:'Validated result',content:{'application/json':{schema:responseSchema}}},'400':{description:'Invalid bounded input'},'401':{description:'Verified account required'},'403':{description:'Origin, authority or feature rejected'},'409':{description:'Catalog, version, review, account or idempotency conflict'},'413':{description:'Byte limit exceeded'},'429':{description:'Rate limited'},'507':{description:'Installation or account capacity reached; operator intervention required'}}}};}
Object.assign(openapi.paths,{
  '/me':route('get','me',ref('Me')),
  '/availability':route('get','availability',{type:'object'},{publicRead:true}),
  '/pity':route('get','pityProgress',{type:'object',additionalProperties:{type:'integer',minimum:0}}),
  '/users':route('get','directory',ref('Page'),{parameters:pageParameters}),
  '/users/{userId}/inventory':route('get','tradeInventory',{allOf:[ref('Page'),{type:'object',required:['owner'],properties:{owner:{type:'object',required:['id','name'],properties:{id:str,name:str}}}}]},{parameters:[{name:'userId',in:'path',required:true,schema:str},...pageParameters],description:'Respects inventory visibility, blocks and transfer policies; filters owner-only bindings.'}),
  '/preferences':route('post','setPreferences',ref('Preferences'),{requestSchema:ref('PreferencesCommand')}),
  '/notifications':route('get','notifications',ref('Page'),{parameters:pageParameters}),
  '/notifications/read':route('post','readNotifications',{type:'object'},{requestSchema:ref('ReadNotifications')}),
  '/trades/counter':route('post','counterTrade',{type:'object'},{requestSchema:ref('CounterTrade'),description:'Atomically closes original escrow and creates a reverse offer; failure leaves the original pending.'}),
  '/operator/catalog':route('get','operatorCatalog',ref('CatalogManifest'),{description:'Opt-in operator route. Contains protected binding definitions; never expose to players.'}),
  '/operator/audit':route('get','audit',{type:'object'},{description:'Opt-in operator invariant diagnosis, read-only.'}),
  '/operator/import/preview':route('post','previewImport',ref('ImportPreview'),{requestSchema:ref('ImportPreviewRequest'),description:'Opt-in operator route. Validation only; 8 MiB limit. Rejects stale base revision.'}),
  '/operator/import/commit':route('post','commitImport',{type:'object'},{requestSchema:ref('ImportCommit'),description:'Opt-in operator route. Revalidates manifest and digest and publishes one atomic revision.'})
});
openapi.paths['/inventory'].get.parameters=pageParameters;
openapi.paths['/inventory'].get.responses['200'].content['application/json'].schema={oneOf:[{type:'array',items:ref('Copy')},ref('Page')]};
for(const value of Object.values(openapi.paths))for(const [method,operation]of Object.entries(value))if(method==='post'&&!operation.parameters.some(p=>p.name==='X-DC-Principal'))operation.parameters.push({name:'X-DC-Principal',in:'header',schema:str,description:'Required by the production host; verified principal binding.'});

openapi.paths['/currency/reconcile'] = {post: {
  operationId:'reconcileCurrency', description:'Optional external-currency provider bridge. The server verifies final settlement; body amounts and identities are never trusted. Deduplicated by provider and transaction, not client retry key.',
  security:[{hostSession:[]}], parameters:[{name:'Origin',in:'header',required:true,schema:{type:'string'}},{name:'X-DC-Principal',in:'header',required:true,schema:{type:'string'}}],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object', required: ['providerId', 'transactionId'],
          properties: {
            providerId: { type: 'string', maxLength: 100 },
            transactionId: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
  },
  responses:{200:{description:'Verified settlement credited exactly once'},400:{description:'Invalid provider or units'},401:{description:'Authentication required'},403:{description:'Origin or ownership rejected'},404:{description:'Gateway/provider not configured'},409:{description:'Pending or conflicting settlement'}}
}};

// Code secrets belong only in operator imports and authenticated reveal responses.
const codeId={type:'string',minLength:1,maxLength:100},requestKey={type:'string',minLength:1,maxLength:128};
schemas.CardType={type:'object',required:['id','name'],properties:{id:codeId,name:str,defaults:{type:'object',additionalProperties:false,properties:Object.fromEntries(['collectionDefault','albumDefault','albumEligible','tradable','tradeUp'].map(k=>[k,{type:'boolean'}]))}}};
schemas.CatalogManifest.properties.cardTypes={type:'array',items:ref('CardType')};
schemas.CodeAttachment={type:'object',additionalProperties:false,required:['id','poolId'],properties:{id:codeId,poolId:codeId,title:{type:'string',maxLength:200},reveal:{enum:['open','scratch','peel'],default:'scratch'},transfer:{enum:['retain','follow-unrevealed','block'],default:'retain'}}};
schemas.CodePool={type:'object',additionalProperties:false,required:['id','providerId','name'],properties:{id:codeId,providerId:codeId,generator:{...codeId,description:'Installed synchronous server code factory. Immutable after pool creation.'},name:{type:'string',maxLength:200},normalization:{enum:['exact','upper-trim'],default:'exact'},enabled:{type:'boolean',default:true},metadata:{type:'object'},instructions:{type:'string',maxLength:2000},redeemUrl:{type:['string','null'],maxLength:2000,description:'HTTPS URL without credentials. Never include a secret code.'}}};
schemas.CodeSummary={type:'object',required:['id','providerId','status','canReveal'],properties:{id:codeId,providerId:codeId,copyId:codeId,status:{enum:['available','allocated','expired','redeemed','revoked']},revealed:{type:'boolean'},reportedUsed:{type:'boolean'},canReveal:{type:'boolean'},reveal:{enum:['open','scratch','peel']},transfer:{enum:['retain','follow-unrevealed','block']},provenance:{type:'object'},history:{type:'array',items:{type:'object'}},metadata:{type:'object'}}};
schemas.CodeCommand={type:'object',required:['key','codeId'],properties:{key:requestKey,codeId}};
schemas.CodeReport={...schemas.CodeCommand,properties:{...schemas.CodeCommand.properties,used:{type:'boolean',default:true}}};
schemas.CodeImport={type:'object',required:['key','poolId','codes'],properties:{key:requestKey,poolId:codeId,metadata:{type:'object'},codes:{type:'array',minItems:1,maxItems:1000,items:{type:'object',additionalProperties:false,required:['code'],properties:{code:{type:'string',minLength:1,maxLength:512,writeOnly:true},externalId:{type:'string',maxLength:300},expiresAt:{type:['string','null'],format:'date-time'},metadata:{type:'object'}}}}}};
schemas.CodeConfirmation={type:'object',required:['providerId','eventId','codeId','status','occurredAt'],properties:{providerId:codeId,eventId:{type:'string',minLength:1,maxLength:300},codeId,status:{enum:['redeemed','revoked']},occurredAt:{type:'string',format:'date-time'}}};
schemas.PackSlot={type:'object',required:['count','pool'],properties:{id:codeId,role:{enum:['card','insert'],default:'card'},count:{type:'integer',minimum:1},pool:{type:'array',items:{type:'object',required:['variantId','weight'],properties:{variantId:codeId,weight:{type:'integer',minimum:1}}}},metadata:{type:'object'},probability:{type:'object',additionalProperties:false,required:['numerator','denominator'],properties:{numerator:{type:'integer',minimum:0,maximum:2147483647},denominator:{type:'integer',minimum:1,maximum:2147483647}},description:'Numerator cannot exceed denominator. One draw per slot, not per card.'}}};
schemas.Copy.properties.codes={type:'array',items:ref('CodeSummary')};
schemas.Copy.properties.provenance={type:'object',description:'Immutable source, definition hashes and pack/slot snapshots. Legacy reconstruction explicitly marks unknown historical fields.'};
Object.assign(schemas.CatalogManifest.properties.cards.items.properties,{type:{type:'string',default:'collectible',description:'Built-in type or declared namespaced custom type.'},behavior:schemas.CardType.properties.defaults});
schemas.CatalogManifest.properties.variants.items.properties.codes={type:'array',maxItems:8,items:ref('CodeAttachment')};
schemas.CatalogManifest.properties.products.items.properties.slots={type:'array',minItems:1,items:ref('PackSlot')};
Object.assign(openapi.paths,{
  '/codes':route('get','codeHistory',{allOf:[ref('Page'),{properties:{items:{type:'array',items:ref('CodeSummary')}}}]},{parameters:pageParameters,description:'Private current and former holder history, including retained and used codes. No plaintext.'}),
  '/codes/reveal':route('post','revealCode',{allOf:[ref('CodeSummary'),{type:'object',required:['code'],properties:{code:{type:'string',readOnly:true}}}]},{requestSchema:ref('CodeCommand'),description:'Current holder only; rechecks entitlement and trade locks on every retry. No-store secret response. Revealing does not redeem.'}),
  '/codes/report':route('post','reportCodeUsage',ref('CodeSummary'),{requestSchema:ref('CodeReport'),description:'Personal used annotation after reveal; never provider-confirmed redemption.'}),
  '/codes/reconcile':route('post','reconcileCode',{type:'object',required:['codeId','status'],properties:{codeId,status:{enum:['unverified','redeemed','revoked']}}},{requestSchema:{type:'object',required:['codeId'],properties:{codeId}},description:'Optional authenticated provider lookup; no external redemption action.'}),
  '/operator/code-pools':{...route('get','codePools',{type:'array',items:{type:'object'}},{description:'Requires codes.manage; only pool configuration and stock counts.'}),...route('post','configureCodePool',{type:'object'},{requestSchema:{type:'object',required:['key','pool'],properties:{key:requestKey,pool:ref('CodePool')}},description:'Requires codes.manage. Provider, normalization and generator are immutable.'})},
  '/operator/codes':route('get','codeInventory',ref('Page'),{parameters:pageParameters,description:'Requires codes.manage. Secret-free stock records with batch, provider reference, holder and lifecycle history. No envelope or lookup fingerprint.'}),
  '/operator/codes/import':route('post','importCodes',{type:'object',required:['batchId','count','ids'],properties:{batchId:str,count:{type:'integer'},ids:{type:'array',items:codeId}}},{requestSchema:ref('CodeImport'),description:'Requires codes.import. Atomic, idempotent, provider-wide duplicate rejection. Maximum 2 MiB.'}),
  '/operator/codes/confirm':route('post','confirmCodeStatus',{type:'object',properties:{codeId,status:{enum:['redeemed','revoked']}}},{requestSchema:ref('CodeConfirmation'),description:'Requires codes.confirm and matching optional provider scope. Trusted server evidence only; deduplicated by provider/event.'}),
});
for(const [path,item]of Object.entries(openapi.paths))if(path.includes('code'))for(const operation of Object.values(item))Object.assign(operation.responses,{'404':{description:'Unknown code, missing entitlement or provider not configured'},'410':{description:'Code unavailable for first reveal'},'502':{description:'Provider response could not be verified'},'503':{description:'Code vault unavailable'},'504':{description:'Provider lookup timed out; status remains unverified'}});

// Trading policy, durable account actions and finite-stock commerce.
const boundedIds={type:'array',maxItems:1000,items:codeId};
const maybeTime={type:['string','null'],format:'date-time'};
schemas.OpeningAction={type:'object',additionalProperties:false,required:['id','handler'],properties:{id:codeId,handler:codeId,params:{type:'object',description:'Public bounded parameters for a server-installed handler; never source code or credentials.'}}};
schemas.CatalogManifest.properties.variants.items.properties.onOpen={type:'array',maxItems:16,items:ref('OpeningAction')};
schemas.TransferRule={type:'object',additionalProperties:false,required:['id','decision','reason'],properties:{id:codeId,decision:{enum:['allow','deny']},reason:{type:'string',maxLength:300},channels:{type:'array',items:{enum:['trade','sale']}},match:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(['copyIds','cardIds','variantIds','lineIds','rarityIds','types','tags'].map(k=>[k,boundedIds])),metadata:{type:'object'}}}}};
schemas.TradingPolicy={type:'object',additionalProperties:false,properties:{enabled:{type:'boolean',default:true},defaultDecision:{enum:['allow','deny'],default:'allow'},rules:{type:'array',maxItems:200,items:ref('TransferRule')},maxCardsPerSide:{type:'integer',minimum:0,maximum:1000,default:100},maxCurrenciesPerSide:{type:'integer',minimum:0,maximum:100,default:20},allowGifts:{type:'boolean',default:true},minAccountAgeSeconds:{type:'integer',minimum:0,maximum:31536000},cooldownSeconds:{type:'integer',minimum:0,maximum:31536000},maxExpirySeconds:{type:'integer',minimum:1,maximum:604800},allowedCurrencyIds:{type:['array','null'],maxItems:100,items:codeId}}};
schemas.TradingSettings={type:'object',required:['key','expectedRevision','policy'],properties:{key:requestKey,expectedRevision:{type:'integer',minimum:0},policy:ref('TradingPolicy')}};
schemas.TransferLock={type:'object',required:['key','copyId'],properties:{key:requestKey,copyId:codeId,locked:{type:'boolean',default:true},reason:{type:'string',maxLength:300},until:maybeTime}};
schemas.CommerceSettings={type:'object',additionalProperties:false,properties:{enabled:{type:'boolean',default:true},playerShops:{type:'boolean',default:false},packResale:{type:'boolean',default:false},allowedCurrencyIds:{type:['array','null'],maxItems:100,items:codeId},maxListingsPerShop:{type:'integer',minimum:1,maximum:10000,default:200},maxStockPerListing:{type:'integer',minimum:1,maximum:1000,default:100},maxRaffleEntries:{type:'integer',minimum:1,maximum:100000,default:10000}}};
schemas.ConfigureCommerce={type:'object',required:['key','expectedRevision','settings'],properties:{key:requestKey,expectedRevision:{type:'integer',minimum:0},settings:ref('CommerceSettings')}};
schemas.CreateShop={type:'object',required:['key','name'],properties:{key:requestKey,name:{type:'string',maxLength:100},kind:{enum:['admin','player'],default:'player'},ownerId:codeId,metadata:{type:'object'}}};
schemas.ListingStock={type:'object',additionalProperties:false,required:['kind'],properties:{kind:{enum:['copies','packs','mint-card','mint-pack','action']},ids:{...boundedIds,uniqueItems:true,minItems:1},variantId:codeId,productId:codeId,quantity:{type:'integer',minimum:1,maximum:1000},handler:codeId,params:{type:'object'}},description:'Existing stock requires ids. Mint sources require quantity and variantId/productId. Custom stock requires quantity and installed handler. Only admin shops with commerce.manage may issue new/custom stock.'};
schemas.RaffleTerms={type:'object',additionalProperties:false,required:['entryClosesAt','claimSeconds','winners'],properties:{entryClosesAt:{type:'string',format:'date-time'},claimSeconds:{type:'integer',minimum:60,maximum:604800},winners:{type:'integer',minimum:1,maximum:1000}}};
schemas.CreateListing={type:'object',required:['key','shopId','title','price','items'],properties:{key:requestKey,shopId:codeId,title:{type:'string',maxLength:200},description:{type:'string',maxLength:2000},price:{type:'object',additionalProperties:false,required:['currencyId','amount'],properties:{currencyId:codeId,amount:{type:'integer',minimum:0,maximum:9007199254740991}}},items:ref('ListingStock'),previewAt:maybeTime,startsAt:{type:'string',format:'date-time'},endsAt:maybeTime,perBuyerLimit:{type:'integer',minimum:1,maximum:1000,default:10},metadata:{type:'object'},raffle:{oneOf:[ref('RaffleTerms'),{type:'null'}]}}};
schemas.ListingQuoteRequest={type:'object',required:['listingId'],properties:{listingId:codeId,quantity:{type:'integer',minimum:1,maximum:1000,default:1}}};
schemas.ListingPurchase={type:'object',required:['key','listingId','quantity','unitIds','digest'],properties:{...schemas.ListingQuoteRequest.properties,key:requestKey,unitIds:{...boundedIds,uniqueItems:true},digest:{type:'string',pattern:'^[a-f0-9]{64}$'}}};
schemas.ListingCommand={type:'object',required:['key','listingId'],properties:{key:requestKey,listingId:codeId}};
schemas.ActionJob={type:'object',required:['id','handler','status','attempts','source'],properties:{id:codeId,handler:codeId,userId:{type:['string','null']},status:{enum:['pending','running','succeeded','dead']},attempts:{type:'integer',minimum:0},totalAttempts:{type:'integer',minimum:0},source:{type:'object'},history:{type:'array',items:{type:'object'}},error:{type:['string','null']},createdAt:maybeTime,completedAt:maybeTime,nextAt:maybeTime},description:'Sanitized delivery history; no executable params, provider output or lease token.'};
Object.assign(openapi.paths,{
  '/trading-policy':route('get','tradingPolicy',{type:'object',properties:{revision:{type:'integer'},policy:ref('TradingPolicy')}}),
  '/operator/trading':route('post','configureTrading',{type:'object'},{requestSchema:ref('TradingSettings'),description:'Requires trading.manage. Replaces the complete live policy with optimistic revision checking.'}),
  '/operator/card-lock':route('post','setCardTransferLock',{type:'object'},{requestSchema:ref('TransferLock'),description:'Requires trading.manage. Individual transfer lock independent of trade/listing escrow; bumps copy version.'}),
  '/commerce-settings':route('get','commerceSettings',{type:'object',properties:{revision:{type:'integer'},settings:ref('CommerceSettings')}}),
  '/operator/commerce':route('post','configureCommerce',{type:'object'},{requestSchema:ref('ConfigureCommerce'),description:'Requires commerce.manage. Player shops and pack resale default off.'}),
  '/shops':{...route('get','shops',ref('Page'),{parameters:pageParameters}),...route('post','createShop',{type:'object'},{requestSchema:ref('CreateShop'),description:'Verified account; player shops must be enabled. Admin shops and another owner require commerce.manage.'})},
  '/operator/shop-status':route('post','setShopEnabled',{type:'object'},{requestSchema:{type:'object',required:['key','shopId','enabled'],properties:{key:requestKey,shopId:codeId,enabled:{type:'boolean'}}},description:'Requires commerce.manage. Disabling prevents purchases without changing completed orders.'}),
  '/listings':{...route('get','listings',ref('Page'),{parameters:[...pageParameters,{name:'shopId',in:'query',schema:codeId}]}),...route('post','createListing',{type:'object'},{requestSchema:ref('CreateListing'),description:'Owner-only stock reservation. Player shops cannot mint or choose custom handlers. Existing copy restrictions still apply.'})},
  '/listings/quote':route('post','quoteListing',{type:'object',required:['listingId','quantity','unitIds','digest','price','items']},{requestSchema:ref('ListingQuoteRequest'),description:'Review exact reserved units and integer total. Sealed pack contents remain hidden.'}),
  '/listings/buy':route('post','buyListing',{type:'object'},{requestSchema:ref('ListingPurchase'),description:'Atomic debit, seller credit, exact-unit transfer and order. Rechecks time, stock, limits and current policy; supplied prices are ignored.'}),
  '/listings/cancel':route('post','cancelListing',{type:'object'},{requestSchema:ref('ListingCommand'),description:'Seller or commerce.manage operator releases unsold stock; completed purchases remain intact.'}),
  '/orders':route('get','orders',ref('Page'),{parameters:pageParameters,description:'Private buyer/seller order history with current fulfillment state.'}),
  '/raffles/enter':route('post','enterRaffle',{type:'object'},{requestSchema:ref('ListingCommand'),description:'Free entry, one per verified account before server deadline. No debit.'}),
  '/raffles/status':route('post','raffleStatus',{type:'object'},{requestSchema:ref('ListingQuoteRequest'),description:'Counts and current account entry/win/claim state, never other entrants.'}),
  '/operator/raffles/draw':route('post','drawRaffle',{type:'object'},{requestSchema:ref('ListingCommand'),description:'Requires raffles.draw. Persists unique winners and exclusive stock reservations once, including when retried with a different key.'}),
  '/cards/open':route('post','openCard',ref('Copy'),{requestSchema:{type:'object',required:['key','copyId'],properties:{key:requestKey,copyId:codeId}},description:'First opening of an owned unreserved card queues its configured actions once.'}),
  '/fulfillments':route('get','fulfillments',{allOf:[ref('Page'),{properties:{items:{type:'array',items:ref('ActionJob')}}}]},{parameters:pageParameters}),
  '/operator/actions':route('get','actionJobs',ref('Page'),{parameters:pageParameters,description:'Requires actions.manage. Sanitized delivery diagnostics.'}),
  '/operator/actions/retry':route('post','retryAction',ref('ActionJob'),{requestSchema:{type:'object',required:['key','jobId'],properties:{key:requestKey,jobId:codeId}},description:'Requires actions.manage. Retry dead delivery using the same downstream idempotency ID. No client delivery acknowledgment or arbitrary execution route exists.'}),
});

Object.assign(schemas,policyDefinitions);
schemas.ImportPreview.properties.policyRevision={type:"integer",minimum:0};
schemas.ImportPreview.required.push("policyRevision");
schemas.ImportCommit.properties.policyRevision={type:"integer",minimum:0,description:"Required once policy administration has changed; commit must match the review."};
Object.assign(openapi.paths,{
 "/operator/card-policies":route("get","cardPolicies",ref("CardPolicyRegistry"),{description:"Requires card-policies.read."}),
 "/operator/card-policies/effective":route("post","effectiveCardPolicy",{type:"object",required:["revision","digest","policy","resources","context"],properties:{revision:{type:"integer"},digest:str,policy:ref("CardPolicyEffective"),context:{type:"object"},resources:{type:"array",items:ref("CardLibraryResource")}}},{requestSchema:{type:"object",properties:{cardId:str,lineId:str,type:str,variantId:str}},description:"Requires catalog.preview. Destination is resolved from trusted catalog identities."}),
 "/operator/card-policies/save":route("post","saveCardPolicy",{type:"object"},{requestSchema:ref("CardPolicySave"),description:"Requires card-policies.manage. Save a draft; active revisions are immutable."}),
 "/operator/card-policies/preview":route("post","previewCardPolicy",ref("CardPolicyImpact"),{requestSchema:ref("CardPolicyPreview"),description:"Read-only impact preview. Requires card-policies.manage."}),
 "/operator/card-policies/activate":route("post","activateCardPolicy",{type:"object"},{requestSchema:ref("CardPolicyActivation"),description:"Requires card-policies.manage and a current impact digest. Existing content is grandfathered."}),
 ...Object.fromEntries(["retire","restore"].map(action=>["/operator/card-policies/"+action,route("post",action+"CardPolicy",{type:"object"},{requestSchema:ref("CardPolicyLifecycle"),description:"Requires card-policies.manage. Retained revisions and historical copies are preserved."})])),
 "/operator/card-resources/save":route("post","saveCardResource",{type:"object"},{requestSchema:ref("CardLibrarySave"),description:"Requires card-policies.manage. Immutable library revision; packages must already be registered."}),
 ...Object.fromEntries(["retire","restore"].map(action=>["/operator/card-resources/"+action,route("post",action+"CardResource",{type:"object"},{requestSchema:ref("CardLibraryLifecycle"),description:"Requires card-policies.manage. Referenced active dependencies cannot be retired."})])),
 "/operator/copy-stats":route("post","updateCopyStats",{type:"object",properties:{copyId:str,version:{type:"integer"}}},{requestSchema:ref("CardCopyStats"),description:"Requires card-stats.provide; admin-source fields additionally require card-policies.manage. Uses the copy's pinned schema and preserves issuedStats."})
});
