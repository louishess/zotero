preferences-window =
    .title = { -app-name } Settings

preferences-appearance-title = Appearance and Language

preferences-auto-recognize-files =
    .label = Automatically retrieve metadata for PDFs and ebooks

preferences-file-renaming-title = File Renaming
preferences-file-renaming-intro =
    { -app-name } can automatically rename files based on the details of the parent item (title, author, etc.) and keep the filenames in sync as you make changes. Downloaded files are always initially named based on the parent item.
preferences-file-renaming-configure-button =
    .label = Configure File Renaming…

preferences-attachment-titles-title = Attachment Titles
preferences-attachment-titles-intro = Attachment titles are <label data-l10n-name="wiki-link">different from filenames</label>. To support some workflows, { -app-name } can show filenames instead of attachment titles in the items list.
preferences-attachment-titles-show-filenames =
    .label = Show attachment filenames in the items list

preferences-reader-title = Reader
preferences-reader-open-epubs-using = Open EPUBs using
preferences-reader-open-snapshots-using = Open snapshots using
preferences-reader-open-in-new-window =
    .label = Open files in new windows instead of tabs
preferences-reader-auto-disable-tool =
    .label = Turn off note, text, and image annotation tools after each use
preferences-reader-ebook-font = Ebook font:
preferences-reader-ebook-hyphenate =
    .label = Enable automatic hyphenation

preferences-read-aloud-title = Read Aloud
preferences-read-aloud-highlight-granularity = Highlight current
preferences-read-aloud-highlight-granularity-paragraph =
    .label = paragraph
preferences-read-aloud-highlight-granularity-sentence =
    .label = sentence
preferences-read-aloud-highlight-granularity-word =
    .label = word

preferences-note-title = Notes
preferences-note-open-in-new-window =
    .label = Open notes in new windows instead of tabs

preferences-color-scheme = Color Scheme:
preferences-color-scheme-auto =
    .label = Automatic
preferences-color-scheme-light =
    .label = Light
preferences-color-scheme-dark =
    .label = Dark

preferences-item-pane-header = Item Pane Header:
preferences-item-pane-header-style = Header Citation Style:
preferences-item-pane-header-locale = Header Language:
preferences-item-pane-header-missing-style = Missing style: <{ $shortName }>

preferences-locate-library-lookup-intro = Library Lookup can find a resource online using your library’s OpenURL resolver.
preferences-locate-resolver = Resolver:
preferences-locate-base-url = Base URL:

preferences-quickCopy-minus =
    .aria-label = { general-remove }
    .label = { $label }
preferences-quickCopy-plus =
    .aria-label = { general-add }
    .label = { $label }

preferences-styleManager-intro = { -app-name } can generate citations and bibliographies in over 10,000 citation styles. Add styles here to make them available when selecting styles throughout { -app-name }.
preferences-styleManager-get-additional-styles =
    .label = Get Additional Styles…
preferences-styleManager-restore-default =
    .label = Restore Default Styles…
preferences-styleManager-add-from-file =
    .tooltiptext = Add a style from a file
    .label = Add from File…
preferences-styleManager-remove = Press { delete-or-backspace } to remove this style.
preferences-citation-dialog = Citation Dialog
preferences-citation-dialog-mode = Citation Dialog Mode:
preferences-citation-dialog-mode-last-used =
    .label = Last Used
preferences-citation-dialog-mode-list =
    .label = List Mode
preferences-citation-dialog-mode-library =
    .label = Library Mode

preferences-advanced-enable-local-api =
    .label = Allow other applications on this computer to communicate with { -app-name }
preferences-advanced-local-api-available = Available at <code data-l10n-name="url">{ $url }</span>
preferences-advanced-local-api-clear-authorizations =
    .label = Clear Write Authorizations
preferences-advanced-server-disabled = The { -app-name } HTTP server is disabled.
preferences-advanced-server-enable-and-restart =
    .label = Enable and Restart
preferences-advanced-language-and-region-title = Language and Region
preferences-advanced-enable-bidi-ui =
    .label = Enable bidirectional text editing utilities
preferences-advanced-pdf-annotations-title = PDF Annotations
preferences-advanced-pdf-annotations-standard =
    .label = Standard
    .tooltiptext = Save annotations as Zotero items. The PDF remains unchanged.
    .aria-description = Save annotations as Zotero items. The PDF remains unchanged.
preferences-advanced-pdf-annotations-pdf-only =
    .label = PDF-only Annotations
    .tooltiptext = Save annotations directly in writable personal-library PDFs. Zotero annotation items are not created.
    .aria-description = Save annotations directly in writable personal-library PDFs. Zotero annotation items are not created.
preferences-advanced-pdf-annotations-dual =
    .label = PDF and Zotero Annotations
    .tooltiptext = Save matching copies in the PDF and as Zotero annotation items for searching and data sync.
    .aria-description = Save matching copies in the PDF and as Zotero annotation items for searching and data sync.
preferences-advanced-pdf-annotations-scope = This setting applies only to writable PDFs in personal libraries. Changes take effect when a PDF is next opened or reloaded.
preferences-advanced-pdf-annotations-transition-title = Change Annotation Storage?
preferences-advanced-pdf-annotations-transition-warning = This change will remove one stored representation after verifying the replacement. Annotations remain available in the selected storage mode.
preferences-advanced-linked-folder-enabled =
    .label = Organize article attachments in a cloud folder
preferences-advanced-linked-folder-description = Uses the Linked Attachment Base Directory above. Main files and supporting information for personal-library journal articles share stable ACS citation folders. Enroll one computer as the organizer; other computers sync, read, and annotate the files.
preferences-advanced-linked-folder-provider = Folder provider:
preferences-advanced-linked-folder-provider-box-drive =
    .label = Box Drive
preferences-advanced-linked-folder-provider-dropbox =
    .label = Dropbox
preferences-advanced-linked-folder-provider-google-drive =
    .label = Google Drive
preferences-advanced-linked-folder-provider-local-folder =
    .label = Local folder
preferences-advanced-linked-folder-available-offline = Keep this folder and its files available offline in your provider’s desktop app before starting or resuming migration.
preferences-advanced-linked-folder-status-disabled = Cloud folder organization is off.
preferences-advanced-linked-folder-status-root-required = Select a Linked Attachment Base Directory before enabling migration.
preferences-advanced-linked-folder-status-root-valid = The linked attachment folder is available.
preferences-advanced-linked-folder-status-root-invalid = The linked attachment folder is unavailable or is not valid for the selected provider.
preferences-advanced-linked-folder-preview =
    .label = Preview Migration
preferences-advanced-linked-folder-start =
    .label = Start Migration
preferences-advanced-linked-folder-pause =
    .label = Pause
preferences-advanced-linked-folder-resume =
    .label = Resume
preferences-advanced-linked-folder-retry =
    .label = Retry Failed
preferences-advanced-linked-folder-status-manager-unavailable = Migration controls will be available after the linked folder manager loads.
preferences-advanced-linked-folder-preview-summary = { $eligible } eligible ({ $size }); { $skipped } skipped. No files have been moved.
preferences-advanced-linked-folder-progress-summary = { $completed } of { $total } completed; { $pending } pending; { $active } active; { $failed } failed; { $deferred } deferred.
preferences-advanced-linked-folder-status-error = Migration status unavailable: { $message }
preferences-advanced-data-dir =
    .value = Data Directory:
preferences-advanced-reset-data-dir =
    .label = Revert to Default Location…
preferences-advanced-custom-data-dir =
    .label = Use Custom Location…
preferences-advanced-default-data-dir =
    .value = (Default: { $directory })
    .aria-label = Default location

preferences-pane-account = Account

-preferences-sync-data-syncing = Data Syncing
preferences-sync-data-syncing-groupbox =
    .aria-label = { -preferences-sync-data-syncing }
preferences-sync-data-syncing-heading = { -preferences-sync-data-syncing }
preferences-sync-data-syncing-description = Log in with your { -app-name } account to sync your data between devices, collaborate with others, and more.
preferences-sync-settings-heading = Sync
preferences-sync-settings-intro = { -app-name } can sync your library data and files across devices. <label data-l10n-name="sync-link">Learn more</label>
preferences-sync-reset-heading = Sync Reset
preferences-sync-fileSyncing-groups =
    .label = Sync attachment files in group libraries using { -app-name } Storage
preferences-sync-fileSyncing-tos = By using { -app-name } Storage, you agree to become bound by its <label data-l10n-name="terms-link">terms and conditions</label>.
preferences-automatic-attachment-downloads-heading = Automatic Attachment Downloads
preferences-automatic-attachment-downloads-description = Choose which attachment types { -app-name } may download automatically. Opening or explicitly downloading a file is always allowed.
preferences-automatic-attachment-download-type-pdf =
    .label = PDF (.pdf)
preferences-automatic-attachment-download-type-docx =
    .label = Word document (.docx)
preferences-automatic-attachment-download-type-md =
    .label = Markdown (.md)
preferences-automatic-attachment-download-type-xlsx =
    .label = Excel workbook (.xlsx)
preferences-automatic-attachment-download-type-mp3 =
    .label = MP3 audio (.mp3)
preferences-automatic-attachment-download-type-mp4 =
    .label = MP4 video (.mp4)
preferences-automatic-attachment-download-type-webm =
    .label = WebM video (.webm)
preferences-account-log-out =
    .label = Log Out…

preferences-sync-reset-restore-to-server-body = { -app-name } will replace “{ $libraryName }” on { $domain } with data from this computer.
preferences-sync-reset-restore-to-server-deleted-items-text = { $remoteItemsDeletedCount } { $remoteItemsDeletedCount ->
        [one] item
        *[other] items
    } in the online library will be permanently deleted.
preferences-sync-reset-restore-to-server-remaining-items-text = { general-sentence-separator }{ $localItemsCount ->
        [0] The library on this computer and the online library will be empty.
        [one] 1 item will remain on this computer and in the online library.
        *[other] { $localItemsCount } items will remain on this computer and in the online library.
    }
preferences-sync-reset-restore-to-server-checkbox-label = { $remoteItemsDeletedCount ->
        [one] Delete 1 item
        *[other] Delete { $remoteItemsDeletedCount } items
    }
preferences-sync-reset-restore-to-server-confirmation-text = delete online library
preferences-sync-reset-restore-to-server-yes = Replace Data in Online Library

preferences-account-log-in =
    .label = Log In
preferences-account-waiting-for-login =
    .value = Waiting for login…
preferences-account-cancel-button =
    .label = { general-cancel }

preferences-account-logged-out-status =
    .value = (logged out)

preferences-account-email-label =
    .value = Email:

preferences-account-switch-accounts =
    .label = Switch Accounts…
preferences-account-switch-text =
    Switching to a different account will remove all { -app-name } data on this computer. Before continuing, make sure all data and files you wish to keep have been synced with the “{ $username }” account or you have a backup of your { -app-name } data directory.
preferences-account-switch-confirmation-text = remove local data
preferences-account-switch-accept = Remove Data and Restart

fulltext-index-status-indexing = Indexing { $indexed } of { $total }…
fulltext-index-status-complete = Search index is up to date
fulltext-stats-attachments-indexed = Attachments indexed:
fulltext-stats-partially-indexed = Partially indexed:
fulltext-stats-not-available = Full-text content or file not available:
fulltext-stats-notes-indexed = Notes indexed:

preferences-advanced-linked-folder-claim-organizer =
    .label = Use This Computer as Organizer
preferences-advanced-linked-folder-release-organizer =
    .label = Release Organizer Role
preferences-advanced-linked-folder-organizer-local = This computer organizes attachments. Other computers can sync, read, and annotate them.
preferences-advanced-linked-folder-organizer-remote = Another computer organizes this folder. Release its organizer role there before claiming it here.
preferences-advanced-linked-folder-organizer-unclaimed = No organizer is enrolled. Choose one computer to organize this folder.
preferences-advanced-linked-folder-organizer-unavailable = Organizer status is unavailable. Check the folder and its ownership records.
preferences-advanced-linked-folder-organizer-root-mismatch = This folder no longer matches this computer’s enrollment. Restore the original folder and its ownership records, or select the intended Linked Attachment Base Directory above. Migration is stopped.
preferences-advanced-linked-folder-organizer-invalid = The folder’s ownership records cannot be verified. Restore those records from a known working copy before enrolling an organizer. Migration is stopped.
preferences-advanced-linked-folder-organizer-conflict = Conflicting ownership records were found. Pause organization on all computers and review the conflict copies in your cloud folder before continuing. Migration is stopped.
preferences-advanced-linked-folder-release-title = Release Organizer Role?
preferences-advanced-linked-folder-release-description = New conversions will stop on this computer. Wait for your cloud app to sync the ownership change before enrolling another computer.
preferences-advanced-linked-folder-job-details =
    .aria-label = Attachments waiting or requiring attention
preferences-advanced-linked-folder-job-detail = { $name }: { $state }. { $message }
preferences-advanced-linked-folder-orphans-heading = Files Retained After Deletion
preferences-advanced-linked-folder-orphans-description = These files were retained after their Zotero items were deleted. Review them before removing cloud files.
preferences-advanced-linked-folder-review-orphans =
    .label = Refresh Retained Files
preferences-advanced-linked-folder-orphans-empty = No retained files require review.
preferences-advanced-linked-folder-orphan-reveal = Show File
preferences-advanced-linked-folder-orphan-retain = Keep File
preferences-advanced-linked-folder-orphan-dismiss = Dismiss from Review
preferences-advanced-linked-folder-orphan-trash = Move to Trash…

preferences-advanced-linked-folder-orphan-retained-error = The file was retained. Verify that this computer is the organizer, the folder is available, and the file has not changed since it was recorded.


config-editor-title = Config Editor
config-editor-intro = Browse application settings, including optional settings that have not been set. Changes are saved immediately. Some settings take effect after restarting Zotero.
config-editor-search =
    .placeholder = Search settings by name or value
    .aria-label = Search settings
config-editor-scope =
    .aria-label = Filter settings
config-editor-all = All settings
config-editor-zotero = Zotero settings
config-editor-modified = Changed settings
config-editor-optional = Not set
config-editor-settings =
    .aria-label = Settings
config-editor-count = Showing { $shown } of { $total } settings
config-editor-more = Show more settings
config-editor-add = Add a custom setting
config-editor-new-name =
    .placeholder = Full setting name
    .aria-label = Full setting name
config-editor-new-value =
    .placeholder = Value (true or false for Yes / No)
    .aria-label = Setting value
config-editor-type =
    .aria-label = Value type
config-editor-boolean = Yes / No
config-editor-string = Text
config-editor-number = Integer
config-editor-save = Save
config-editor-reset = Reset
config-editor-yes = Yes
config-editor-no = No
config-editor-state-default = Default
config-editor-state-changed = Changed
config-editor-state-unset = Not set
config-editor-state-locked = Locked
config-editor-invalid-integer = Enter a whole number between −2147483648 and 2147483647.
config-editor-invalid-boolean = Enter true or false.
config-editor-invalid-name = Enter a full setting name without spaces.
config-editor-existing = This setting already exists. Search for its name to edit it.
config-editor-unavailable = Some optional settings could not be loaded. Registered settings are still available.
