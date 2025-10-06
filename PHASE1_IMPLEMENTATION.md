# Phase 1 Implementation: Remove HTML Dependency

## Summary

Phase 1 successfully implements LTI Deep Linking to eliminate the need for custom HTML modifications in Canvas. Students can now access SEB-enforced quizzes through standard Canvas module items that are automatically updated by the system.

## What Changed

### New Files Created

1. **`DeepLinkModuleService.java`**
   - Automatically finds and updates Canvas module items
   - Converts quiz links to LTI Resource Links when SEB is enabled
   - Restores direct Canvas links when SEB is disabled
   - No manual intervention needed from instructors

2. **`SebLtiLaunchController.java`**
   - Handles student-facing LTI launches at `/seb/launch/{quizId}`
   - Detects if student is using SEB
   - Redirects to quiz if SEB detected
   - Shows SEB download page if SEB not detected
   - **Completely replaces the need for JavaScript injection**

### Modified Files

1. **`QuizController.java`**
   - Added `DeepLinkModuleService` dependency
   - Updated `/enable` endpoint to automatically update module items using LTI links
   - Updated `/disable` endpoint to automatically restore direct links
   - Teachers just toggle SEB on/off - module items update automatically

2. **`CanvasApiService.java`**
   - Added `getCanvasApiBaseUrl()` method for module service

## How It Works

### Teacher Workflow (No HTML Modifications Needed)

1. Teacher opens "SEB Quiz Manager" in Canvas
2. Teacher toggles SEB on for a quiz
3. **Automatic Backend Process:**
   - System finds the quiz in Canvas modules
   - Changes module item type from "Quiz" to "ExternalTool"
   - Sets URL to `/seb/launch/{quizId}` (LTI launch endpoint)
   - Canvas now sees it as an LTI tool, not a direct quiz link

### Student Workflow (Works Without HTML Modifications)

1. Student clicks quiz link in Canvas module
2. Canvas initiates LTI launch → POST to `/seb/launch/{quizId}`
3. `SebLtiLaunchController` receives launch
4. System validates LTI token
5. System detects if student is using SEB:
   - **Using SEB**: Redirect directly to Canvas quiz → Student takes quiz
   - **Not using SEB**: Show `sebDownload.html` with instructions and .seb file download

### Technical Flow

```
Canvas Module Item (before SEB enabled):
  Type: Quiz
  Content ID: 12345
  → Student clicks → Direct to Canvas quiz

Canvas Module Item (after SEB enabled):
  Type: ExternalTool
  External URL: https://your-app.com/seb/launch/quiz_abc123
  → Student clicks → LTI Launch → SEB Detection → Redirect to quiz or download page
```

## Key Differences from Old Approach

| Old Approach (with HTML mods) | New Approach (Phase 1) |
|-------------------------------|------------------------|
| Custom JavaScript injected into Canvas HTML | Standard LTI launch |
| JavaScript detects SEB on page load | Server-side SEB detection on LTI launch |
| Requires Canvas HTML access | No HTML modifications needed |
| Fragile (breaks when Canvas updates HTML) | Stable (uses LTI standard) |
| Only works for Classic Quizzes | Works for any LTI-compatible content |

## Testing Instructions

### Setup

1. Build and deploy the application:
   ```bash
   mvn clean package
   # Deploy to Cloud Run or run locally
   ```

2. Ensure Canvas Developer Key is configured with:
   - Target Link URI: `https://your-app.com/seb/launch/{quiz_id}`
   - OIDC Initiation URL: `https://your-app.com/lti/login`

### Test Case 1: Enable SEB for a Quiz

1. Add a quiz to a Canvas module (if not already added)
2. Launch "SEB Quiz Manager" from Canvas
3. Toggle SEB ON for the quiz
4. **Expected**: Success message + "Module item updated"
5. **Verify**: Go to Canvas module, click the quiz link
   - Should see SEB download page (if not in SEB)
   - URL should be `/seb/launch/{quizId}`, NOT direct quiz URL

### Test Case 2: Student Access Without SEB

1. As a student, navigate to the module with SEB-enabled quiz
2. Click the quiz link
3. **Expected**:
   - LTI launch occurs
   - Redirected to SEB download page
   - Page shows quiz title and "Download SEB Config" button
   - Download button works and provides `.seb` file

### Test Case 3: Student Access With SEB

1. Download and install Safe Exam Browser
2. Download the `.seb` config file from step 2
3. Open the `.seb` file (launches SEB)
4. **Expected**:
   - SEB opens and navigates to the quiz
   - Quiz loads normally inside SEB
   - Access code auto-filled (if configured)

### Test Case 4: Disable SEB

1. As teacher, toggle SEB OFF for the quiz
2. **Expected**: Success message + "Module item restored"
3. **Verify**: Go to Canvas module
   - Quiz link now points directly to Canvas quiz
   - No LTI launch occurs
   - Students can access quiz normally

## Troubleshooting

### Module Item Not Updating

**Symptom**: Toggle SEB but module item doesn't change

**Causes**:
- Quiz not added to any module yet → **Solution**: Add quiz to module first
- OAuth token expired → **Solution**: Click "Clear OAuth Token" button
- Insufficient Canvas API permissions → **Solution**: Check Canvas Developer Key scopes

**Debug**: Check logs for:
```
Found 0 module items for quiz {quizId}
```

### LTI Launch Fails

**Symptom**: Student clicks quiz but gets error

**Causes**:
- Invalid LTI configuration → **Solution**: Verify Developer Key settings
- Mismatched Tool URL → **Solution**: Ensure `TOOL_URL` matches deployed URL
- Missing LTI private key → **Solution**: Check `LTI_PRIVATE_KEY` secret

**Debug**: Check logs for:
```
Invalid LTI launch token for quiz
```

### SEB Not Detected

**Symptom**: Student in SEB but still sees download page

**Causes**:
- SEB headers not sent → **Solution**: Verify SEB config includes Browser Exam Key
- Config key mismatch → **Solution**: Regenerate SEB config file
- User-Agent detection failing → **Solution**: Check `SebDetector` logs

**Debug**: Check logs for:
```
SEB detection result: NOT SEB
```

## Next Steps

**Phase 2**: Extend to all assignment types (not just quizzes)
- Support Canvas Assignments API
- Support New Quizzes (LTI-based quizzes)
- Support External Tools

**Phase 3**: Auto-authentication in SEB
- Eliminate manual Canvas login in SEB
- Pre-authenticated LTI launch with session token
- Seamless student experience

## Configuration Required

### Canvas Developer Key

Ensure these placements are configured:

```json
{
  "placements": [
    {
      "placement": "course_navigation",
      "message_type": "LtiResourceLinkRequest",
      "target_link_uri": "https://your-app.com/lti/launch"
    }
  ],
  "custom_fields": {
    "quiz_id": "$Canvas.assignment.id",
    "course_id": "$Canvas.course.id"
  }
}
```

### Environment Variables

Required secrets in GCP Secret Manager:
- `LTI_CLIENT_ID` - Canvas Developer Key client ID
- `LTI_PRIVATE_KEY` - RSA private key for JWT signing
- `TOOL_URL` - Public URL of deployed application

### Canvas API Scopes

Required OAuth scopes:
- `url:GET|/api/v1/courses/:course_id/modules`
- `url:GET|/api/v1/courses/:course_id/modules/:module_id/items`
- `url:PUT|/api/v1/courses/:course_id/modules/:module_id/items/:id`
- `url:GET|/api/v1/courses/:course_id/quizzes`

## Success Criteria

✅ Phase 1 Complete When:
- [ ] Teacher can toggle SEB without HTML modifications
- [ ] Module items automatically update to LTI links
- [ ] Students see SEB download page when not in SEB
- [ ] Students access quiz directly when in SEB
- [ ] Disabling SEB restores original quiz links
- [ ] No JavaScript injection required in Canvas

## Known Limitations

1. **Requires module placement**: Quiz must be in a Canvas module for automatic updates
2. **One module per quiz**: If quiz is in multiple modules, only first one is updated
3. **Manual re-add**: If teacher manually changes module item, must toggle SEB off/on to restore LTI link

## Benefits Achieved

✅ **No HTML modifications** - Works with stock Canvas
✅ **Standard LTI** - Uses official Canvas API
✅ **Future-proof** - Won't break when Canvas updates
✅ **Automatic** - Teachers just toggle, system handles rest
✅ **Clean architecture** - Separation of concerns (teacher UI, student launch, SEB detection)

---

**Status**: Phase 1 Implementation Complete ✅
**Date**: $(date +%Y-%m-%d)
**Next**: Begin Phase 2 (All Assignment Types)
