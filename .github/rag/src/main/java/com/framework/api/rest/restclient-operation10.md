---
id: restclient-operation10-invocation
title: Call RestClient operation10 as a lightweight API-client action in tests.
tags:
  - rest
  - api
  - client
  - smoke
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation10
sourceHash: dfcffb229e37efbcac36fe310f8d89ba13f6d6a613bb22f76f7ad82d0c88f3e8
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` capability directly rather than adding new helper code.
Requires: A constructed `RestClient` instance in scope before calling this method.
API: public void operation10()

```java
restClient.operation10();
```
