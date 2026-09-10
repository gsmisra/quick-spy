---
id: operation9-restclient-call
title: Call `operation9` on `RestClient` to execute this predefined API client action.
tags:
  - restclient
  - api
  - method-call
  - internal-library
  - java
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation9
sourceHash: 27d17838bda3d25f7e666ac07cde566d1d6998dc597bdb3448200b813cc48b91
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` capability named `operation9` rather than creating a new client action.
Requires: An initialized `RestClient` instance in scope before calling this instance method.
API: public void operation9()

```java
restClient.operation9();
```
