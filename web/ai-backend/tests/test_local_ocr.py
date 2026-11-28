from unittest.mock import patch, MagicMock
import pytest
from app import local_ocr, assistant

@pytest.mark.parametrize('question', ['Read the sign', 'What does the label say?', 'What is on the sign?', 'Lis le panneau', 'Que dit le panneau ?', 'Lire le texte', 'اقرأ اللافتة', 'شو مكتوب', 'شو بتقول اللافتة'])
def test_reading_intent(question):
    assert local_ocr.is_reading(question)

@pytest.mark.parametrize('question', ['List objects', 'What colour is the sign?', 'What color is the text?', 'Is anyone listening?', 'Quelle est la couleur du panneau ?', 'ما لون اللافتة'])
def test_other_visual_questions_stay_with_vision(question):
    assert not local_ocr.is_reading(question)

@pytest.mark.parametrize('text,score', [(123,.9), ('wrong',float('nan')), ('wrong',2)])
def test_invalid_worker_response_is_unavailable(text,score):
    response=MagicMock();response.json.return_value={'status':'ok','confidence':score,'text':text}
    with patch('app.local_ocr.httpx.Client') as client:
        client.return_value.__enter__.return_value.post.return_value=response
        answer,uncertain=local_ocr.read(b'jpeg','en')
        assert uncertain and 'unavailable' in answer

@pytest.mark.parametrize('lang',['en','ar','fr'])
@pytest.mark.parametrize('status,score,text',[('ok',.99,'EXIT 24'),('unclear',.2,'invented'),('no_text',0,'')])
def test_only_confident_text_is_read(lang,status,score,text):
    response=MagicMock();response.json.return_value={'status':status,'confidence':score,'text':text}
    with patch('app.local_ocr.httpx.Client') as client:
        client.return_value.__enter__.return_value.post.return_value=response
        answer,uncertain=local_ocr.read(b'jpeg',lang)
        assert uncertain==(status!='ok')
        assert (answer==text)==(status=='ok')
        if status=='unclear': assert 'invented' not in answer

def test_reading_does_not_fall_back_to_generative_vision():
    memory=MagicMock();memory.image.return_value=b'jpeg'
    with patch('app.local_ocr.read',return_value=('unclear',True)) as read, patch('app.vision_provider.ask') as vision:
        assert assistant.describe('read the sign','en',[{'frame_id':'a'}],memory)==('unclear',True)
        read.assert_called_once();vision.assert_not_called()
