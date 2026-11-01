# Missing and narrow render-width repair — 0.3.66

Independent Team Orchestrator testing attributed 109 invalid-tree warnings to Session Panel. Its frame subtracted four from an absent `bodyColumns`, producing NaN widths rejected by the native host.

Session Panel now uses a positive finite body column count, then the host viewport, then an 80-column fallback. It floors and bounds the frame width to the host's supported range. A narrow progress row also keeps its name-column width positive when a long stage pill is wider than the available text block. Ordinary wide-window layout is unchanged.

The official runner passed **319 tests, 0 failed**, across two files. Nine regression cases mount the actual band with absent, nonfinite, invalid, narrow, normal and oversized column inputs; render a long progress stage; open Settings; and require every numeric Box width to be finite, nonnegative and no larger than 10000. Validation passed with existing catalog metadata warnings. The final version/documentation bump follows the tested product source.

This repairs Session Panel rendering. It does not establish Team Orchestrator's full automatic lifecycle acceptance, which is running separately. No global settings, installed plugins or real project stores were changed by these tests.
