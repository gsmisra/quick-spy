---
id: restclient-operation3-invoke
title: Call RestClient.operation3 to run the third predefined REST client operation.
tags:
  - rest
  - client
  - api
  - java
  - method
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation3
sourceHash: a852eb2751d09dbe17cad97d401d080172fba7dc55aa3aa9af24745414487445
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code should trigger the existing `operation3` behavior through `RestClient` rather than implementing a new call path.
Requires: A `RestClient` instance is already created and available to the caller.
API: public void operation3()

```java
restClient.operation3();
```
