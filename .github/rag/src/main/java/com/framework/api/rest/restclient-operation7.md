---
id: operation7-restclient-call
title: Invoke RestClient operation7 to trigger the operation7 API call hook.
tags:
  - restclient
  - api
  - operation7
  - java
  - smoke
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation7
sourceHash: 4e827465dda242647db6ecd1b2f230c2ebce1f0970ff660edb9f123d7a63a3f1
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined `operation7` client action directly instead of adding new wrapper code.
Requires: A `RestClient` instance is already created and available to call instance methods.
API: public void operation7()

```java
restClient.operation7();
```
