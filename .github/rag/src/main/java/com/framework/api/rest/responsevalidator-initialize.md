---
id: response-validator-initialize
title: Initializes a `ResponseValidator` instance for API response-validation workflows.
tags:
  - api
  - rest
  - validation
  - initialization
  - setup
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#initialize
sourceHash: 284bdc1e420ef520c1f46f5f506d5dde77d0e5f614b09cc75cd9664569251cc6
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to run the standard `ResponseValidator` initialization step rather than creating a custom setup helper.
Requires: An instantiated `ResponseValidator` object.
API: public void initialize()

```java
responseValidator.initialize();
```
