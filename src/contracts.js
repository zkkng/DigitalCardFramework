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
schemas.Me={type:'object',required:['userId','displayName','preferences','role'],properties:{userId:str,displayName:str,preferences:ref('Preferences'),role:{enum:['player','admin']}}};
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
