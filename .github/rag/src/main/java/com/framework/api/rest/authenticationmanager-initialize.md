---
id: authentication-manager-initialize
title: Initialize the AuthenticationManager component before authentication-related API interactions.
tags:
  - authentication
  - initialization
  - api
  - setup
  - manager
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#initialize
sourceHash: 5ded25be85b82a7591ec14920e9288952c385e800de1efdd08c4f21d5db32589
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs the `AuthenticationManager` explicitly initialized before running authentication-dependent API steps.
Requires: An existing `AuthenticationManager` instance.
API: public void initialize()

```java
authenticationManager.initialize();
```
