import { Component, Input, Output, EventEmitter } from "@angular/core";
import * as SurveyEditor from "surveyjs-editor";
import * as Survey from "survey-angular";

Survey.StylesManager.applyTheme("bootstrap");

@Component({
  selector: "surveyjs-component",
  template: `<div id="surveyContainer"></div>`
})
export class SurveyjsComponent {
  editor: SurveyEditor.SurveyEditor;

  ngOnInit() {
    var surveyJSON = {
      title: "Azure Readiness",
      description:
        "Objective: To identify readiness of the Azure infrastructure for hosting a typical SAP workload.",
      pages: [
        {
          name: "Home",
          elements: [
            { type: "text", name: "Name", title: "Name", isRequired: true },
            {
              type: "text",
              name: "Company",
              title: "Company",
              isRequired: true
            },
            { type: "text", name: "Project", title: "Project" }
          ],
          title: "Metadata"
        },
        {
          name: "Level1",
          elements: [
            {
              type: "checkbox",
              name: "Level1Question1",
              title: "Level1Question1Title",
              description: "Level1Question1Description",
              choices: ["item1", "item2"]
            }
          ],
          title: "Level1 Title",
          description: "Level1 Description"
        },
        {
          name: "Level2.1",
          elements: [
            {
              type: "radiogroup",
              name: "question3",
              title: "2.1 question3",
              requiredIf: "{Level1Question1} = ['item1']",
              hasComment: true,
              commentText: "Comments/Additional Information",
              choices: ["item1", "item2", "item3"]
            },
            {
              type: "checkbox",
              name: "question4",
              title: "2.1 question4",
              requiredIf: "{Level1Question1} = ['item1']",
              choices: ["item1", "item2", "item3"]
            }
          ],
          visible: false,
          visibleIf: "{Level1Question1} = ['item1']",
          title: "Level2.1Title",
          description: "Level2.1Description"
        },
        {
          name: "Level2.2",
          elements: [
            {
              type: "checkbox",
              name: "question5",
              title: "2.2 question5",
              requiredIf: "{Level1Question1} = ['item2']",
              choices: ["item1", "item2", "item3"]
            },
            {
              type: "checkbox",
              name: "question6",
              title: "2.2 question6",
              requiredIf: "{Level1Question1} = ['item2']",
              choices: ["item1", "item2", "item3"]
            }
          ],
          visible: false,
          visibleIf: "{Level1Question1} = ['item2']",
          title: "Level2.2Title",
          description: "Level2.2Description"
        },
        {
          name: "Attachments",
          elements: [
            {
              type: "file",
              name: "Attachment",
              title: "Attachments",
              description:
                "Please attach any files that you feel may be helpful for context. Please limit file size to 1MB",
              allowMultiple: true,
              waitForUpload: true,
              maxSize: 1048576
            }
          ],
          title: "Attachments"
        }
      ],
      showProgressBar: "top",
      progressBarType: "questions",
      goNextPageAutomatic: true
    };

    var model = new Survey.ReactSurveyModel(surveyJSON);
    Survey.SurveyNG.render("surveyContainer", { model: model });
  }
}
