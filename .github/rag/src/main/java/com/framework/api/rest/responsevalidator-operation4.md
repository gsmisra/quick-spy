---
id: response-validator-operation4-invoke
title: Invoke `operation4` on `ResponseValidator` to run its built-in validation operation hook.
tags:
  - api
  - rest
  - response
  - validator
  - operation4
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation4
sourceHash: 50fa668a601278dd71af4559c97f932952f607afaf093b15cd24c1950c73ec6c
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `ResponseValidator` operation entry point directly instead of adding custom helper logic.

Requires: An initialized `ResponseValidator` instance available to the caller.

API: public void operation4()

```java
responseValidator.operation4();
```
