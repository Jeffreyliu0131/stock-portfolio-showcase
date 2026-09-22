# Buffett Research Eval

This eval is a credential-free, synthetic release gate for the first AAPL/MSFT research slice. It does not call SEC, OpenAI, DeepSeek, or any production deployment.

The fixed cases cover request scope, evidence binding, direct-trade and impersonation rejection, generated-number rejection, and the owner-earnings assumption boundary. Provider integration tests separately replay synthetic SEC and OpenAI Responses payloads.

Run:

```bash
npm run eval:buffett
```

Passing this fixture gate proves only the encoded contracts on synthetic inputs. It does not prove live retrieval freshness, citation entailment, investment research quality, recruiter value, or financial outcomes. Live-provider and human review remain explicit future gates.
