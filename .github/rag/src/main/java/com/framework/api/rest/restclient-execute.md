---
id: restclient-execute-action
title: Calls the RestClient execute method to trigger its built-in execution step.
tags:
  - rest
  - client
  - execute
  - api
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#execute
sourceHash: c89a3444c2bd64c053f9e80b52043caaa5ccce9e03d861c63c96cf55bb2bc2c3
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing RestClient execution entry point directly instead of adding custom request-trigger code.
Requires: A `RestClient` instance must already be available before calling this method.
API: public void execute()

```java
new RestClient().execute();
```
