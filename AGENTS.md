# Gauntle cohort G4
```sunsay midnight is project deadline ```
* Government companies will be hiring. so we need to a part of the context
* We have gemini pro, nano banana pro, all google models with our email max.petrusenko@gfachallenger.gauntletai.com
* tech stack might be different for a different project ( Typescript, Python, Go, Rails we should know why its better used than the other )

the project we will be building?
https://gauntlet-portal.web.app/login
max.petrusenko@gfachallenger.gauntletai.com

Project i might want to do: ( its might be different than client's project. look further )
AI avatar  + ai images + late.dev + scheduling + latest news search + open claw ( should ahve access to create boards,)

Critical:
- thinking claude, speed cursor, + clarity codex to review
- if we change desicions. why did we change desicions ( we will have all the context, we will need to defent those desicions. so keep a file DESIONS.md, we should have smth impressive )
- we're making system decisions
- critical peace of thinking
- e2e ttd ( end to end test driven development, don't use for front end )
- front end ( cursor agent use tests and review them, dont rewrite tests to pass them, use cursor (60$) and 100$ cc)
- does code scale, does code perform well?
- session folder contain our transcripts from live sessions ( and also screenshots)
- If we build UI we should be components and types ( if react use 17 or newer version)
- we should use indexing on cursor docs

Tell Lera:
- Zack generated preseach doc and asked questions about it ( do presearch doc and throw it in different ai's to get all responses from multiple directions )
- why we choose certain stack and why?
- where we will host? ( what is main focus now should be( it might change later) system design -> store data, security, file structure, legacy code, naming, testing, refactoring, improve it )
- use google deep research functionality for research, if not use perplexity
- review if we covered everything and ak me questions if we have everything is set 
- Time to ship? requirements? scaling and load profiles? budget? time to ship? team? authentication?
- we will use presearch doc ( $60 save it to drive and save as pdf ), then prd and stack
cc - use init then put in tasks



Docs & Tests:
- skip if done -> generate PRD and MVP for the doc we received (requirements.md ) as you reviwing docs as me questions so i can make sure you understand it too 
- walk throught the documentation every time if smth got updated. ( PRD, MVP, Patterns, duplcation)
- use www.Skills.sh url we can download progressively ( project level skill + symlink)
- we must build TESTS for every new feature we build ( examples: https://github.com/steipete/CodexBar/tree/main/Tests, e2e ttd is what guys like jeffrey emanuel and steve yegge  )
- we should use Linear to follow our tickes
- maintenance cost?


AI will go through our project to rate it

Tasks ( should have Tasks.md )
1. can i download all transcript and save it from google to gauntle notion page as curriculum
2. 1 hour deliverables. hard deadlines
3. good resource for system design? ( search top rate and most forked repos, we look at META, OPenAI, Claude,  )
4. IP if we select hiring parner
5. If using cursor rules and skills
6. give this to open claw
7. remind to use aqua and whisper for talking to ai instead of writing

## Submission Requirements (Must Include)
- deployed apps
- demo video
- pre-search doc
- ai development log (1 page dev log)
- LinkedIn or X post of what I did in 1 week
- ai cost analysis
- doc submission is PDF
- add PAT token if GitHub repo access needs it

## AI Development Log (Required)
Submit a 1-page document covering:
- Tools & Workflow: which AI coding tools were used and how they were integrated.
- MCP Usage: which MCPs were used (if any) and what they enabled.
- Effective Prompts: 3-5 prompts that worked well (include actual prompts).
- Code Analysis: rough % of AI-generated vs hand-written code.
- Strengths & Limitations: where AI excelled and where it struggled.
- Key Learnings: insights about working with coding agents.

## AI Cost Analysis (Required)
Track development and testing costs:
- LLM API costs (OpenAI, Anthropic, etc.).
- Total tokens consumed (input/output breakdown).
- Number of API calls made.
- Any other AI-related costs (embeddings, hosting, etc.).

Production cost projections must include:
- 100 users: $___/month
- 1,000 users: $___/month
- 10,000 users: $___/month
- 100,000 users: $___/month

Include assumptions:
- average AI commands per user per session
- average sessions per user per month
- token counts per command type

## Technical Stack (Possible Paths)
- Backend: Firebase (Firestore, Realtime DB, Auth), Supabase, AWS (DynamoDB, Lambda, WebSockets), or custom WebSocket server.
- Frontend: React/Vue/Svelte with Konva.js, Fabric.js, PixiJS, HTML5 Canvas, Vanilla JS, or any framework with canvas support.
- AI integration: OpenAI GPT-4 or Anthropic Claude with function calling.
- Deployment: Vercel, Firebase Hosting, or Render.

Use whichever stack helps ship fastest, but complete Pre-Search first to justify decisions.

## Build Strategy (Priority Order)
1. Cursor sync - get two cursors moving across browsers.
2. Object sync - create sticky notes that appear for all users.
3. Conflict handling - handle simultaneous edits.
4. State persistence - survive refreshes and reconnects.
5. Board features - shapes, frames, connectors, transforms.
6. AI commands (basic) - single-step creation/manipulation.
7. AI commands (complex) - multi-step template generation.

## Critical Guidance
- Multiplayer sync is the hardest part; start here.
- Build vertically: finish one layer before the next.
- Test with multiple browser windows continuously.
- Throttle network speed during testing.
- Test simultaneous AI commands from multiple users.

## Deadline and Deliverables
- Deadline: Sunday 10:59 PM CT.
- GitHub repository: setup guide, architecture overview, deployed link.
- Demo video (3-5 min): realtime collaboration, AI commands, architecture explanation.
- Pre-Search document: completed checklist from Phase 1-3.
- AI Development Log: 1-page breakdown using required template.
- AI Cost Analysis: dev spend + projections for 100/1K/10K/100K users.
- Deployed app: publicly accessible, supports 5+ users with auth.
- Social post: X or LinkedIn with description, features, demo/screenshots, tag @GauntletAI.
