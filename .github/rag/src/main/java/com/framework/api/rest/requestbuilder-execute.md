---
id: requestbuilder-execute-action
title: Runs the `RequestBuilder` execution step for an already prepared API request flow.
tags:
  - api
  - requestbuilder
  - execute
  - rest
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#execute
sourceHash: 381dd6772258468b9ef25a8a7dbca12fccbcab11e25f26f2a78c3c043396221e
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test code needs to trigger the `RequestBuilder` action directly instead of adding custom execution glue.
Requires: A `RequestBuilder` instance must already be available in scope.
API: public void execute()

```java
requestBuilder.execute();
```
