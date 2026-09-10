---
id: operation4-rest-client-invoke
title: Call the RestClient operation4 method when a test needs to trigger that client action.
tags:
  - restclient
  - api
  - method-call
  - smoke
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation4
sourceHash: a3d0673975ca85589d7267978a910b2e8aa759797a527a3188345475a7cf9199
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` capability directly instead of adding a new helper path.
Requires: A `RestClient` instance must be constructible in the current test context.
API: public void operation4()

```java
new RestClient().operation4();
```
