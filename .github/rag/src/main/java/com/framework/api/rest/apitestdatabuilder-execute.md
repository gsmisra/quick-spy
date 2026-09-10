---
id: api-test-data-builder-execute
title: Runs the ApiTestDataBuilder execution hook for API test data flows.
tags:
  - api
  - testdata
  - builder
  - execution
  - java
  - rest
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#execute
sourceHash: bdcc3ec80680a77ddfee443e0bd90f30bd5ebcd72b172b4713f21875d62c9013
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the ApiTestDataBuilder execution step directly instead of adding custom helper code.
Requires: An initialized `ApiTestDataBuilder` instance in scope before invocation.
API: public void execute()

```java
new ApiTestDataBuilder().execute();
```
