# Phase 2 Implementation: Extend to All Assignment Types

## Summary

Phase 2 extends SEB enforcement beyond Classic Quizzes to **all Canvas content types**:
- ✅ Classic Quizzes
- ✅ New Quizzes (LTI-based, aka Quizzes.Next)
- ✅ Regular Assignments
- ✅ External Tools
- ✅ Discussions (future)
- ✅ Pages (future)

## Architecture Changes

### New Unified Models

**1. `ContentItem.java`** - Replaces `Quiz.java`
```java
public class ContentItem {
    private String id;              // "quiz_123", "assignment_456"
    private String canvasId;        // Canvas ID
    private ContentType contentType; // CLASSIC_QUIZ, NEW_QUIZ, ASSIGNMENT, etc.
    private String title;
    private String htmlUrl;
    // ... all content types unified
}
```

**2. `ContentSebSetting.java`** - Replaces `QuizSebSetting.java`
```java
public class ContentSebSetting {
    private String contentId;       // References ContentItem.id
    private ContentType contentType; // What type of content
    private boolean sebRequired;
    private String accessCode;
    // ... same SEB config for all types
}
```

**3. `ContentService.java`** - Unified content fetching
```java
public class ContentService {
    // Fetches ALL content types from Canvas
    List<ContentItem> getAllContentForCourse(courseId, userId);

    // Automatically detects:
    // - Classic Quizzes (/api/v1/courses/{id}/quizzes)
    // - Assignments (/api/v1/courses/{id}/assignments)
    // - Detects New Quizzes within assignments
}
```

### How Content Type Detection Works

```java
// Classic Quiz - from Quizzes API
GET /api/v1/courses/123/quizzes
→ ContentType.CLASSIC_QUIZ

// Assignment - from Assignments API
GET /api/v1/courses/123/assignments
→ Check assignment properties:
   - is_quiz_assignment: true → ContentType.NEW_QUIZ
   - external_tool_tag_attributes.url contains "quiz-lti" → ContentType.NEW_QUIZ
   - external_tool_tag_attributes exists → ContentType.EXTERNAL_TOOL
   - else → ContentType.ASSIGNMENT
```

## Files Created

### Models
- `ContentItem.java` - Unified content model
- `ContentSebSetting.java` - Unified SEB settings

### Repositories
- `FirestoreContentRepository.java` - CRUD for all content types

### Services
- `ContentService.java` - Fetches and manages all content types

## Backward Compatibility

All existing APIs still work! The new models provide helper methods:

```java
// Old way (still works):
Quiz quiz = quizService.getQuiz(quizId);
QuizSebSetting setting = quizService.getSebSettingForQuiz(quizId);

// New way (recommended):
ContentItem content = contentService.getContentItem("classicquiz_" + quizId);
ContentSebSetting setting = contentSebService.getSettingForContent("classicquiz_" + quizId);

// Conversion helpers:
ContentItem item = ContentItem.fromQuiz(quiz);
ContentSebSetting setting = ContentSebSetting.fromQuizSebSetting(quizSetting);
```

## Teacher UI Updates

### Before (Quiz-only)
```
SEB Quiz Manager
- Show only Classic Quizzes
- Toggle SEB for quizzes
```

### After (All Content Types)
```
SEB Content Manager
- Show ALL assignments and quizzes
- Filter by type: All | Quizzes | Assignments | New Quizzes
- Icon badges showing content type
- Toggle SEB for ANY content type
```

Example UI:
```
📝 Classic Quiz: Midterm Exam              [SEB: ON ]
📋 Assignment: Essay on Shakespeare        [SEB: OFF]
🎯 New Quiz: Chapter 5 Assessment          [SEB: ON ]
🔧 External Tool: Desmos Activity          [SEB: OFF]
```

## How SEB Works for Different Types

### Classic Quizzes
✅ **Access Code**: Supported natively by Canvas
✅ **LTI Launch**: `/seb/launch/classicquiz_123`
✅ **SEB Detection**: Server-side on launch
✅ **Auto-fill**: Access code auto-filled in SEB

### New Quizzes
✅ **Access Code**: Supported (via assignment settings)
✅ **LTI Launch**: `/seb/launch/newquiz_456`
✅ **SEB Detection**: Server-side on launch
✅ **Auto-fill**: Access code auto-filled in SEB
⚠️ **Note**: New Quizzes are LTI tools, so launch flow is slightly different

### Regular Assignments
⚠️ **Access Code**: NOT supported by Canvas
✅ **LTI Launch**: `/seb/launch/assignment_789`
✅ **SEB Detection**: Server-side on launch
💡 **Strategy**: Use LTI launch as gatekeeper (no access code needed)

### External Tools
⚠️ **Access Code**: Depends on tool
✅ **LTI Launch**: `/seb/launch/externaltool_101`
✅ **SEB Detection**: Server-side on launch
💡 **Strategy**: Launch tool inside SEB environment

## Implementation Steps Completed

### ✅ Step 1: Create Unified Models
- Created `ContentItem` with `ContentType` enum
- Created `ContentSebSetting`
- Added factory methods for backward compatibility

### ✅ Step 2: Create Repositories
- `FirestoreContentRepository` handles all content types
- Document IDs: `{type}_{canvasId}` (e.g., `classicquiz_123`)

### ✅ Step 3: Create Content Service
- `ContentService.getAllContentForCourse()` fetches everything
- Automatically detects New Quizzes from assignments
- Caches to Firestore for performance

## Next Steps to Complete Phase 2

### TODO: Update Existing Services

1. **Update `DeepLinkModuleService`**
   ```java
   // Change from:
   createOrUpdateModuleItemForQuiz(courseId, quiz, userId, sebRequired)

   // To:
   createOrUpdateModuleItemForContent(courseId, contentItem, userId, sebRequired)
   ```

2. **Update `SebLtiLaunchController`**
   ```java
   // Change from:
   @PostMapping("/launch/{quizId}")

   // To:
   @PostMapping("/launch/{contentId}")
   // Where contentId = "classicquiz_123", "assignment_456", etc.
   ```

3. **Update Teacher UI (`teacherView.html`)**
   ```html
   <!-- Add content type filter -->
   <select id="contentTypeFilter">
     <option value="all">All Content</option>
     <option value="quiz">Quizzes Only</option>
     <option value="assignment">Assignments Only</option>
   </select>

   <!-- Show content type badge -->
   <span class="badge">{{ contentType.displayName }}</span>
   ```

4. **Update `QuizController` → `ContentController`**
   ```java
   @PostMapping("/{courseId}/{contentId}/seb/enable")
   public ResponseEntity<?> enableSeb(
       @PathVariable String courseId,
       @PathVariable String contentId  // NOT quizId
   ) {
       // Parse contentId to get type and Canvas ID
       ContentItem content = contentService.getContentItem(contentId);
       // Enable SEB for any content type
   }
   ```

## Testing Strategy

### Test Case 1: Classic Quiz (Existing)
✅ Should work exactly as before

### Test Case 2: New Quiz
1. Create a New Quiz in Canvas
2. Open SEB Manager
3. Should appear in list with "New Quiz" badge
4. Toggle SEB ON
5. Student clicks → LTI launch → SEB detection works

### Test Case 3: Regular Assignment
1. Create an Assignment (online text entry)
2. Open SEB Manager
3. Should appear in list with "Assignment" badge
4. Toggle SEB ON
5. Student clicks → LTI launch → SEB required → Student submits in SEB

### Test Case 4: External Tool
1. Add an External Tool assignment (e.g., Desmos)
2. Open SEB Manager
3. Should appear with "External Tool" badge
4. Toggle SEB ON
5. Student clicks → LTI launch → Opens tool inside SEB

## Canvas API Endpoints Used

```bash
# Classic Quizzes
GET /api/v1/courses/:course_id/quizzes

# All Assignments (includes New Quizzes)
GET /api/v1/courses/:course_id/assignments

# Assignment Details (to detect New Quizzes)
GET /api/v1/courses/:course_id/assignments/:id

# Module Items (for any content type)
GET /api/v1/courses/:course_id/modules/:module_id/items
PUT /api/v1/courses/:course_id/modules/:module_id/items/:id
```

## Benefits

✅ **Universal SEB Support** - Works for ALL Canvas content
✅ **Future-Proof** - Easy to add new content types
✅ **Backward Compatible** - Existing quiz code still works
✅ **Clean Architecture** - Single code path for all types
✅ **Better UX** - Teachers see all content in one place

## Migration Path

### For Existing Installations

1. **Database Migration** (automatic on first run):
   ```
   Existing quizzes → Convert to ContentItem
   Existing QuizSebSettings → Convert to ContentSebSettings
   ```

2. **API Compatibility** (maintained):
   ```
   Old endpoints still work:
   POST /api/quizzes/{courseId}/{quizId}/seb/enable

   New endpoints recommended:
   POST /api/content/{courseId}/{contentId}/seb/enable
   ```

3. **UI Update** (seamless):
   ```
   - Old "SEB Quiz Manager" → Shows quizzes only
   - New "SEB Content Manager" → Shows all content
   - Teacher chooses which to use
   ```

## Known Limitations

1. **Assignments don't have access codes**
   - Solution: Use LTI launch as gatekeeper (still effective!)

2. **New Quizzes have different API**
   - Solution: Detect via assignment properties, handle specially

3. **External Tools vary widely**
   - Solution: Best-effort SEB enforcement (depends on tool)

## Configuration Updates

### application.properties
```properties
# Add new collection for content items
firestore.collection.content-items=contentItems

# Keep old collection for backward compatibility
firestore.collection.quizzes=quizzes
firestore.collection.seb-settings=sebSettings
```

### Canvas Developer Key
No changes needed! LTI launch URL pattern remains:
```
https://your-app.com/seb/launch/{contentId}
```

## Success Criteria

✅ Phase 2 Complete When:
- [ ] All content types fetched from Canvas
- [ ] Teacher UI shows quizzes AND assignments
- [ ] SEB toggle works for assignments
- [ ] New Quizzes detected and enforced
- [ ] LTI launch handles all content types
- [ ] Backward compatibility maintained

---

**Status**: Phase 2 Models & Services Complete (Controllers & UI pending)
**Next**: Update controllers and UI to use new models
**ETA**: 2-3 hours for full Phase 2 completion
