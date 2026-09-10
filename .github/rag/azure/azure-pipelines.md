---
id: azure-pipelines-main-trigger
title: Defines the Azure Pipelines configuration that triggers runs from the main branch.
tags:
  - azure
  - pipelines
  - ci
  - yaml
  - trigger
  - main-branch
automationMode:
  - api
language:
  - java
  - python
imports: {}
sourcePath: .azure/azure-pipelines.yml
sourceHash: 45315a3d9b06fdc54fd568ff304d3733b825cbd62ee8da84ccf1ddd64547c7d9
sourceHashScheme: sha256-raw-v1
sourceMapped: false
---

Use: Use this existing pipeline definition when tests need repository-native CI trigger behavior instead of creating ad hoc pipeline config.
Requires: The repository must include this file at `.azure/azure-pipelines.yml` and be connected to an Azure Pipelines project.
API: Reference the whole-file config at `.azure/azure-pipelines.yml` (signature: `azure-pipelines.yml`).

```yaml
pipelineFile: .azure/azure-pipelines.yml
```
