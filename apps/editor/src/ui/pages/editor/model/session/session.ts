import type { LoadedBranch } from '../../../../../app/queries/loadBranch';
import { branchView } from '../../lib/projection';
import type { EditorDocument } from '../../../../../app/editor/document';
import type { BoardModel } from '../../../../../board';
import type { EditorDependencies } from '../../../../di';
import type { EditorView } from '../../lib/projection';

export const emptyModel: BoardModel = {
    version: 0,
    cards: [],
    connections: [],
    selection: null,
    state: 'loading',
};
export type Session = {
    identity: string;
    document: EditorDocument;
    dependencies: EditorDependencies;
    view: EditorView;
    template: BoardModel;
};

export function expandedMembers(session: Session): ReadonlySet<string> {
    return new Set(
        session.view.connections
            .filter(
                connection =>
                    session.view.expanded.get(
                        `${connection.sourceBlockId}/${connection.sourceMemberId}`
                    ) !== false
            )
            .map(connection => connection.sourceMemberId)
    );
}

export function integrate(target: Session, branch: LoadedBranch, blockId?: string): void {
    target.document.integrateNodes(branch.nodes);
    branch.pages.forEach(page =>
        target.document.addPage(page, 'replace', expandedMembers(target))
    );
    const view = branchView(branch, blockId);
    target.view.branches.set(view.blockId, view);
}
