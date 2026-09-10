---
id: operation18-rest-client-invoke
title: Call the RestClient operation18 method to trigger its operation-level API action.
tags:
  - restclient
  - api
  - method-call
  - operation18
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation18
sourceHash: 7f6b40ddd4b348e594236c34d7150aff02a0eeeca17a6386bf80eda4a6e23c62
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` capability by name instead of adding a new client helper.
Requires: A `RestClient` instance is already created and available in scope.
API: public void operation18()

```java
restClient.operation18();
```
