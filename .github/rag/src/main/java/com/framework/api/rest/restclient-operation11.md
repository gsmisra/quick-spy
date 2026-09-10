---
id: restclient-operation11-noarg-call
title: Invoke the `operation11` method on `RestClient` when a test needs this built-in no-argument client action.
tags:
  - rest
  - api
  - client
  - method-call
  - no-args
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation11
sourceHash: 747ab5e347cea9272a6096aca810278e3e85eb32882b46e291166dd2af856d1d
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to trigger `RestClient`’s existing `operation11` behavior directly instead of creating a new helper path.
Requires: A constructed `RestClient` instance available to the caller.
API: public void operation11()

```java
restClient.operation11();
```
