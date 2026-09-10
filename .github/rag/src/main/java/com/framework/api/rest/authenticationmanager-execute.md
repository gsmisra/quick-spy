---
id: authentication-manager-execute
title: Invoke the AuthenticationManager execution entrypoint for authentication-related flow steps.
tags:
  - authentication
  - manager
  - execute
  - rest
  - api
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#execute
sourceHash: 814a58acc15c6caa10b821ee5c1c939149c42a81045ef5d3cebec9574a79a481
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the `AuthenticationManager` execution hook directly instead of adding custom helper logic.
Requires: An initialized `AuthenticationManager` instance must already be available to call this instance method.
API: public void execute()

```java
authenticationManager.execute();
```
