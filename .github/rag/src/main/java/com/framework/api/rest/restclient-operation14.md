---
id: restclient-operation14-invoke
title: Invoke RestClient operation14 as a no-argument API action.
tags:
  - restclient
  - api
  - java
  - no-args
  - invocation
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation14
sourceHash: 6d05376e3e400cf5cf0d8181294328dd6bbcfcb35315da8ae32836ad0df41248
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to execute the built-in `operation14` action on an existing `RestClient` instance instead of adding a custom helper.
Requires: A constructed `RestClient` object in scope.
API: public void operation14()

```java
restClient.operation14();
```
