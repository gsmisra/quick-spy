---
id: restclient-operation1-trigger
title: Trigger RestClient operation1 as a lightweight API-call marker.
tags:
  - rest
  - client
  - api
  - operation1
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation1
sourceHash: 980f1925dbdbceca94c02589426bc2f2949953298fa2feb070c623ff505c8ceb
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined `RestClient` operation entry point instead of adding custom call plumbing.
Requires: An instantiated `RestClient` object.
API: public void operation1()

```java
restClient.operation1();
```
