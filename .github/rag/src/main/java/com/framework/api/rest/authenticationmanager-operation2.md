---
id: operation2-authenticationmanager-invoke
title: Calls the AuthenticationManager operation2 method with no arguments.
tags:
  - authentication
  - manager
  - method-call
  - java
  - api
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation2
sourceHash: 987ed502908829578a65fa018030b9b83cff7b933c91d2c3c9f3489367d45e6b
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger `operation2` on an existing `AuthenticationManager` instance rather than adding a new helper path.
Requires: A constructed `AuthenticationManager` instance in scope before invocation.
API: public void operation2()

```java
authenticationManager.operation2();
```
