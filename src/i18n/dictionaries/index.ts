import { common } from './common';
import { header } from './header';
import { startPage } from './startPage';
import { auth } from './auth';
import { subscription } from './subscription';
import { manuscriptFormatter } from './manuscriptFormatter';
import { bookModals } from './bookModals';
import { editor } from './editor';
import { mastery } from './mastery';
import { tableOfContents } from './tableOfContents';
import { scenario } from './scenario';
import { quickAi } from './quickAi';
import { generateTextFromImage } from './generateTextFromImage';
import { aiStudio } from './aiStudio';
import { characterEditModal } from './characterEditModal';
import { generateCharacterModal } from './generateCharacterModal';
import { charactersView } from './charactersView';
import { illustrationsView } from './illustrationsView';
import { generateIllustrationModal } from './generateIllustrationModal';
import { layoutView } from './layoutView';
import { bookPreviewView } from './bookPreviewView';
import { exportView } from './exportView';
import { coverDesignerView } from './coverDesignerView';
import { kdpPublishingModal } from './kdpPublishingModal';
import { qrFootnotesView } from './qrFootnotesView';
import { changeLogView } from './changeLogView';
import { mediaLibraryView } from './mediaLibraryView';
import { versionSnapshotModal } from './versionSnapshotModal';
import { collaborationDrawer } from './collaborationDrawer';
import { addParticipantsModal } from './addParticipantsModal';
import { roleManagementModal } from './roleManagementModal';
import { inviteAccept } from './inviteAccept';
import { model3DViewer } from './model3DViewer';
import { coursesView } from './coursesView';
import { pdfEditorView } from './pdfEditorView';
import { importBookModal } from './importBookModal';
import { importWizard } from './importWizard';
import { landingFunnel } from './landingFunnel';
import { onboardingTour } from './onboardingTour';
import { dashboard } from './dashboard';
import { styleView } from './styleView';
import { knowledgeView } from './knowledgeView';
import { trainersView } from './trainersView';
import { mindBoard } from './mindBoard';
import { structureBuilder } from './structureBuilder';
import { portfolioView } from './portfolioView';
import { publishingHub } from './publishingHub';
import { apiKeysView } from './apiKeysView';
import { narration } from './narration';

/**
 * Об'єднані дерева перекладів. Кожен новий словник (наступний екран) —
 * окремий файл у цій папці, доданий сюди одним рядком у кожній з двох ліній.
 */
export const dictionaries = {
  uk: {
    common: common.uk,
    header: header.uk,
    startPage: startPage.uk,
    auth: auth.uk,
    subscription: subscription.uk,
    manuscriptFormatter: manuscriptFormatter.uk,
    bookModals: bookModals.uk,
    editor: editor.uk,
    mastery: mastery.uk,
    tableOfContents: tableOfContents.uk,
    scenario: scenario.uk,
    quickAi: quickAi.uk,
    generateTextFromImage: generateTextFromImage.uk,
    aiStudio: aiStudio.uk,
    characterEditModal: characterEditModal.uk,
    generateCharacterModal: generateCharacterModal.uk,
    charactersView: charactersView.uk,
    illustrationsView: illustrationsView.uk,
    generateIllustrationModal: generateIllustrationModal.uk,
    layoutView: layoutView.uk,
    bookPreviewView: bookPreviewView.uk,
    exportView: exportView.uk,
    coverDesignerView: coverDesignerView.uk,
    kdpPublishingModal: kdpPublishingModal.uk,
    qrFootnotesView: qrFootnotesView.uk,
    changeLogView: changeLogView.uk,
    mediaLibraryView: mediaLibraryView.uk,
    versionSnapshotModal: versionSnapshotModal.uk,
    collaborationDrawer: collaborationDrawer.uk,
    addParticipantsModal: addParticipantsModal.uk,
    roleManagementModal: roleManagementModal.uk,
    inviteAccept: inviteAccept.uk,
    model3DViewer: model3DViewer.uk,
    coursesView: coursesView.uk,
    pdfEditorView: pdfEditorView.uk,
    importBookModal: importBookModal.uk,
    importWizard: importWizard.uk,
    landingFunnel: landingFunnel.uk,
    onboardingTour: onboardingTour.uk,
    dashboard: dashboard.uk,
    styleView: styleView.uk,
    knowledgeView: knowledgeView.uk,
    trainersView: trainersView.uk,
    mindBoard: mindBoard.uk,
    structureBuilder: structureBuilder.uk,
    portfolioView: portfolioView.uk,
    publishingHub: publishingHub.uk,
    apiKeysView: apiKeysView.uk,
    narration: narration.uk,
  },
  en: {
    common: common.en,
    header: header.en,
    startPage: startPage.en,
    auth: auth.en,
    subscription: subscription.en,
    manuscriptFormatter: manuscriptFormatter.en,
    bookModals: bookModals.en,
    editor: editor.en,
    mastery: mastery.en,
    tableOfContents: tableOfContents.en,
    scenario: scenario.en,
    quickAi: quickAi.en,
    generateTextFromImage: generateTextFromImage.en,
    aiStudio: aiStudio.en,
    characterEditModal: characterEditModal.en,
    generateCharacterModal: generateCharacterModal.en,
    charactersView: charactersView.en,
    illustrationsView: illustrationsView.en,
    generateIllustrationModal: generateIllustrationModal.en,
    layoutView: layoutView.en,
    bookPreviewView: bookPreviewView.en,
    exportView: exportView.en,
    coverDesignerView: coverDesignerView.en,
    kdpPublishingModal: kdpPublishingModal.en,
    qrFootnotesView: qrFootnotesView.en,
    changeLogView: changeLogView.en,
    mediaLibraryView: mediaLibraryView.en,
    versionSnapshotModal: versionSnapshotModal.en,
    collaborationDrawer: collaborationDrawer.en,
    addParticipantsModal: addParticipantsModal.en,
    roleManagementModal: roleManagementModal.en,
    inviteAccept: inviteAccept.en,
    model3DViewer: model3DViewer.en,
    coursesView: coursesView.en,
    pdfEditorView: pdfEditorView.en,
    importBookModal: importBookModal.en,
    importWizard: importWizard.en,
    landingFunnel: landingFunnel.en,
    onboardingTour: onboardingTour.en,
    dashboard: dashboard.en,
    styleView: styleView.en,
    knowledgeView: knowledgeView.en,
    trainersView: trainersView.en,
    mindBoard: mindBoard.en,
    structureBuilder: structureBuilder.en,
    portfolioView: portfolioView.en,
    publishingHub: publishingHub.en,
    apiKeysView: apiKeysView.en,
    narration: narration.en,
  },
};
